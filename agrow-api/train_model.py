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

# 2024 Administrative Census statistics for downscale feature tagging
CENSUS_SAMPLES = {
    "Watermelon": {
        "Papar": 56.0, "Beaufort": 64.0, "Tawau": 45.4, "Kudat": 26.0, "Ranau": 0.0, "Tenom": 0.0
    },
    "Durian": {
        "Tenom": 168.0, "Tawau": 366.0, "Sipitang": 723.4, "Ranau": 1457.1, "Papar": 315.5, "Beaufort": 410.8
    },
    "Cabbage": {
        "Ranau": 644.5, "Papar": 0.0, "Beaufort": 0.0, "Tawau": 0.0, "Tenom": 0.0
    }
}

def generate_biophysical_labels_from_db():
    """
    Connects to the PostGIS database, pulls registered crops and physical grids 
    including newly introduced NASA climate metrics, and runs a heuristic matching pass.
    """
    print("🔌 Connecting to database to fetch physical terrain and crop matrices...")
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as conn:

        crop_rows = conn.execute(text(
            "SELECT id, name, ideal_ph_min, ideal_ph_max, max_slope_pct, min_soil_depth_cm FROM crops;"
        )).fetchall()
        
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

    if not crop_rows or not grid_rows:
        print("⚠️ Database empty! Please run your seeder (seed.py) first to populate crops and grids.")
        return None

    crops = [dict(row._mapping) for row in crop_rows]
    grids = [dict(row._mapping) for row in grid_rows]

    print(f"📊 Sourced {len(crops)} Crops and {len(grids)} Spatial Grid Coordinates from DB.")
    print("🧪 Running biophysical rules matching & downscaling pipeline...")

    training_samples = []

    for crop in crops:
        crop_name = crop["name"]
        for grid in grids:
            district = grid["district"]
            district_census = CENSUS_SAMPLES.get(crop_name, {}).get(district, 0.0)
            
            # --- EVALUATE VETO LIMITATIONS (LIEBIG'S LAW OF THE MINIMUM) ---
            is_viable = True
            
            if grid["slope_pct"] > crop["max_slope_pct"]:
                is_viable = False
            if grid["soil_depth_cm"] < crop["min_soil_depth_cm"]:
                is_viable = False
            if crop_name == "Watermelon" and grid["elevation_meters"] > 350.0:
                is_viable = False
            if crop_name == "Cabbage" and grid["elevation_meters"] < 600.0:
                is_viable = False

            # --- ASSIGN TRAINING SUITABILITY CLASSES ---
            if not is_viable:
                suitability_label = "N" 
            elif district_census == 0.0:
                suitability_label = "S3" 
            else:
                ph = grid["soil_ph"]
                if crop["ideal_ph_min"] <= ph <= crop["ideal_ph_max"]:
                    suitability_label = "S1" 
                else:
                    suitability_label = "S2" 

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
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.20, random_state=42)

    # 5. Initialize & Train the Random Forest Classifier
    print(f"\n🧠 Training Random Forest Classifier Ensemble across {X_train.shape[1]} distinct features...")
    classifier = RandomForestClassifier(n_estimators=180, max_depth=10, random_state=42)
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