import os
import joblib
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.ensemble import RandomForestClassifier

load_dotenv()

DB_USER = 'postgres'
DB_PASSWORD = os.getenv("DATABASE_PASSWORD")
DB_HOST = 'localhost'
DB_PORT = '5432'
DB_NAME = 'agrow_db'

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

SUPPORTED_PREDICTION_CROPS = ("Banana", "Cabbage", "Durian", "Watermelon")
EMPIRICAL_RANGE_FIELDS = (
    "elevation_meters",
    "annual_rainfall_mm",
    "solar_radiation",
    "root_zone_moisture",
)


def normalize_name(value):
    return str(value or "").strip().casefold()


def build_productive_environment_ranges(crops, grids, district_production):
    ranges = {}
    for crop in crops:
        crop_key = normalize_name(crop["name"])
        productive_grids = [
            grid
            for grid in grids
            if district_production.get(
                (crop_key, normalize_name(grid["district"])),
                0.0,
            ) > 0
        ]

        crop_ranges = {}
        for field in EMPIRICAL_RANGE_FIELDS:
            values = [
                float(grid[field])
                for grid in productive_grids
                if grid.get(field) is not None
            ]
            if values:
                series = pd.Series(values)
                crop_ranges[field] = (
                    float(series.quantile(0.10)),
                    float(series.quantile(0.90)),
                )
        ranges[crop_key] = crop_ranges
    return ranges


def is_within_range(value, bounds):
    if value is None or not bounds:
        return False
    lower, upper = bounds
    return lower <= float(value) <= upper

def generate_biophysical_labels_from_db():
    """
    Connects to the PostGIS database, pulls registered crops and physical grids 
    including newly introduced NASA climate metrics, and runs a heuristic matching pass.
    """
    print("🔌 Connecting to database to fetch physical terrain and crop matrices...")
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as conn:

        crop_rows = conn.execute(text("""
            SELECT
                id,
                name,
                ideal_ph_min,
                ideal_ph_max,
                max_slope_pct,
                min_soil_depth_cm,
                min_annual_rainfall
            FROM crops
            WHERE lower(name) IN ('banana', 'cabbage', 'durian', 'watermelon');
        """)).fetchall()
        
        grid_rows = conn.execute(text("""
            SELECT 
                id, 
                district, 
                elevation_meters, 
                slope_pct, 
                soil_depth_cm, 
                soil_ph,
                annual_rainfall_mm,
                solar_radiation,
                root_zone_moisture
            FROM spatial_grids;
        """)).fetchall()
        # Replace the hardcoded CENSUS_SAMPLES data with historical
        # district-level production aggregated from PostgreSQL.
        production_rows = conn.execute(text("""
            SELECT
                crop_name,
                district,
                SUM(production_tonnes) AS production_tonnes
            FROM crop_statistics
            WHERE lower(crop_name) IN ('banana', 'cabbage', 'durian', 'watermelon')
              AND district IS NOT NULL
            GROUP BY crop_name, district;
        """)).fetchall()

    if not crop_rows or not grid_rows:
        print("⚠️ Database empty! Please run your seeder (seed.py) first to populate crops and grids.")
        return None

    crops = [dict(row._mapping) for row in crop_rows]
    grids = [dict(row._mapping) for row in grid_rows]
    district_production = {
        (
            normalize_name(row._mapping["crop_name"]),
            normalize_name(row._mapping["district"]),
        ): float(row._mapping["production_tonnes"] or 0)
        for row in production_rows
    }
    productive_environment_ranges = build_productive_environment_ranges(
        crops,
        grids,
        district_production,
    )

    print(f"📊 Sourced {len(crops)} Crops and {len(grids)} Spatial Grid Coordinates from DB.")
    print("🧪 Running biophysical rules matching & downscaling pipeline...")

    training_samples = []

    for crop in crops:
        crop_name = crop["name"]
        crop_key = normalize_name(crop_name)
        crop_ranges = productive_environment_ranges.get(crop_key, {})
        for grid in grids:
            raw_district = grid["district"] or ""
            district = raw_district.strip()
            historical_production = district_production.get(
                (crop_key, normalize_name(district)),
                0.0,
            )
            
            # --- EVALUATE VETO LIMITATIONS (LIEBIG'S LAW OF THE MINIMUM) ---
            is_viable = True
            
            if grid["slope_pct"] > crop["max_slope_pct"]:
                is_viable = False
            if grid["soil_depth_cm"] < crop["min_soil_depth_cm"]:
                is_viable = False
            if (
                grid["annual_rainfall_mm"] is not None
                and float(grid["annual_rainfall_mm"])
                < float(crop["min_annual_rainfall"])
            ):
                is_viable = False
            if crop_name == "Watermelon" and grid["elevation_meters"] > 350.0:
                is_viable = False
            if crop_name == "Cabbage" and grid["elevation_meters"] < 600.0:
                is_viable = False

            # --- ASSIGN TRAINING SUITABILITY CLASSES ---
            if not is_viable:
                suitability_label = "N"
            else:
                matched_conditions = [
                    crop["ideal_ph_min"] <= grid["soil_ph"] <= crop["ideal_ph_max"],
                    is_within_range(
                        grid["elevation_meters"],
                        crop_ranges.get("elevation_meters"),
                    ),
                    is_within_range(
                        grid["annual_rainfall_mm"],
                        crop_ranges.get("annual_rainfall_mm"),
                    ),
                    is_within_range(
                        grid["solar_radiation"],
                        crop_ranges.get("solar_radiation"),
                    ),
                    is_within_range(
                        grid["root_zone_moisture"],
                        crop_ranges.get("root_zone_moisture"),
                    ),
                    historical_production > 0.0,
                ]
                condition_score = sum(matched_conditions)
                if condition_score >= 5:
                    suitability_label = "S1"
                elif condition_score >= 3:
                    suitability_label = "S2"
                else:
                    suitability_label = "S3"

            # NASA climate values into the mapping dictionary
            training_samples.append({
                "crop_name": crop_name,
                "elevation_meters": float(grid["elevation_meters"]),
                "slope_pct": float(grid["slope_pct"]),
                "soil_ph": float(grid["soil_ph"]),
                "soil_depth_cm": int(grid["soil_depth_cm"]),
                "annual_rainfall_mm": float(grid["annual_rainfall_mm"]) if grid["annual_rainfall_mm"] is not None else 2400.0,
                "solar_radiation": float(grid["solar_radiation"]) if grid["solar_radiation"] is not None else 16.5,
                "root_zone_moisture": float(grid["root_zone_moisture"]) if grid["root_zone_moisture"] is not None else 0.50,
                "suitability_class": suitability_label
            })

    return pd.DataFrame(training_samples)

def execute_training_pipeline():
    print("\n" + "="*60)
    print("      AGROW  MODEL TRAINING PIPELINE RUNNING")
    print("="*60)

    # 1. Fetch training datasets
    df = generate_biophysical_labels_from_db()
    if df is None or df.empty:
        print("❌ Training canceled: No data points available.")
        return

    print("Training label distribution:")
    print(df.groupby(["crop_name", "suitability_class"]).size().unstack(fill_value=0))

    # 2. Encode categorical column (crop name)
    encoder = LabelEncoder()
    df["crop_encoded"] = encoder.fit_transform(df["crop_name"])

    # 3. Separate features and targets
    features = [
        "crop_encoded", 
        "elevation_meters", 
        "slope_pct", 
        "soil_ph", 
        "soil_depth_cm",
        "annual_rainfall_mm",
        "solar_radiation",
        "root_zone_moisture"
    ]
    X = df[features]
    y = df["suitability_class"]

    # 4. Train-Test split (80-20 validation)
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=42,
        stratify=y,
    )

    # 5. Initialize & Train the Random Forest Classifier
    print(f"\n🧠 Training Random Forest Classifier Ensemble across {X_train.shape[1]} distinct features...")
    classifier = RandomForestClassifier(
        n_estimators=180,
        max_depth=10,
        class_weight="balanced_subsample",
        random_state=42,
    )
    classifier.fit(X_train, y_train)

    accuracy = classifier.score(X_test, y_test)
    print(f"🎯 Classifier successfully trained!")
    print(f"   Validation Accuracy: {accuracy * 100:.2f}%")

    # 6. Save model assets directly to app/ml_assets/ directory
    assets_dir = os.path.join(os.path.dirname(__file__), "app/ml_assets")
    os.makedirs(assets_dir, exist_ok=True)

    model_path = os.path.join(assets_dir, "crop_classifier.joblib")
    encoder_path = os.path.join(assets_dir, "crop_encoder.joblib")

    joblib.dump(classifier, model_path)
    joblib.dump(encoder, encoder_path)

    print(f"💾 Model files successfully serialized & saved:")
    print(f"   - {model_path}")
    print(f"   - {encoder_path}")
    print("="*60 + "\n")

if __name__ == "__main__":
    execute_training_pipeline()
