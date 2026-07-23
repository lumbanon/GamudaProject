import csv
import math
import os
import requests
import random
from pathlib import Path
from time import sleep
from app.database.session import SessionLocal, Base
from app.models.user import User
from app.models.crop import Crop
from app.models.crop_statistic import CropStatistic
from app.models.spatial_grid import SpatialGrid
from passlib.context import CryptContext
from geoalchemy2.elements import WKTElement
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DB_USER='postgres'
DB_PASSWORD= os.getenv("DATABASE_PASSWORD")
DB_HOST='localhost'
DB_PORT='5432'
DB_NAME='agrow_db'

DATABASE_URL=f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

NASA_API_KEY = os.getenv("NASA_API_KEY", "NONE")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# USER TABLE
pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
CROPS_CSV_FILENAME = "crops.csv"


# Resolve CSV files from an env var first, then common project locations.
# This lets seed.py work whether it is run from agrow-api, another folder,
# or with a custom CSV path for local/import testing.
def resolve_csv_path(filename, env_var_name, label):
    """Find a CSV by env var or common project-relative locations."""
    configured_path = os.getenv(env_var_name)
    if configured_path:
        path = Path(configured_path).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        path = path.resolve()

        if not path.is_file():
            raise FileNotFoundError(
                f"{label} CSV not found at {env_var_name}={path}"
            )
        return path

    script_dir = Path(__file__).resolve().parent
    candidates = [
        script_dir / filename,
        Path.cwd() / filename,
        script_dir / "data" / filename,
        script_dir.parent / filename,
        script_dir.parent.parent / filename,
    ]

    checked_paths = []
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate in checked_paths:
            continue
        checked_paths.append(candidate)
        if candidate.is_file():
            return candidate

    searched = "\n - ".join(str(path) for path in checked_paths)
    raise FileNotFoundError(
        f"Could not find {filename}. "
        f"Set {env_var_name} or place the CSV in one of these locations:\n - {searched}"
    )


def resolve_crops_csv_path():
    """Find the crops CSV or use CROPS_CSV when provided."""
    return resolve_csv_path(CROPS_CSV_FILENAME, "CROPS_CSV", "Crops")

def seed_user():
    db = SessionLocal()

    existing_user = db.query(User).filter(User.email == 'sj@s.com').first()
    if existing_user:
        print('User already exist')
        return
    
    test_user = User(
        full_name='Steve Joseph',
        email='sj@s.com',
        hashed_password=pwd_context.hash('123abc'),
        role='Agronomist',
        is_active=True
    )

    db.add(test_user)
    db.commit()
    db.close()

def seed_crops():
    db = SessionLocal()

    try:
        csv_path = resolve_crops_csv_path()
        print(f"📄 Importing crop data from: {csv_path}")

        # Load existing crops once.
        existing_crops = {
            str(crop.name or "").strip().casefold(): crop
            for crop in db.query(Crop).all()
        }

        inserted_count = 0
        overwritten_count = 0

        with csv_path.open(
            "r",
            encoding="utf-8-sig",
            newline="",
        ) as csv_file:
            reader = csv.DictReader(csv_file)

            required_columns = {
                "name",
                "scientific_name",
                "min_temp_limit",
                "ideal_temp_min",
                "ideal_temp_max",
                "max_temp_limit",
                "min_annual_rainfall",
                "min_soil_depth_cm",
                "ideal_ph_min",
                "ideal_ph_max",
                "max_slope_pct",
            }

            csv_columns = set(reader.fieldnames or [])
            missing_columns = required_columns - csv_columns

            if missing_columns:
                raise ValueError(
                    "crop.csv is missing columns: "
                    + ", ".join(sorted(missing_columns))
                )

            for row_number, row in enumerate(reader, start=2):
                name = str(row["name"] or "").strip()
                scientific_name = str(
                    row["scientific_name"] or ""
                ).strip()

                if not name:
                    raise ValueError(
                        f"Row {row_number}: name is blank"
                    )

                if not scientific_name:
                    raise ValueError(
                        f"Row {row_number}: scientific_name is blank"
                    )

                crop_data = {
                    "name": name,
                    "scientific_name": scientific_name,
                    "min_temp_limit": float(
                        row["min_temp_limit"]
                    ),
                    "ideal_temp_min": float(
                        row["ideal_temp_min"]
                    ),
                    "ideal_temp_max": float(
                        row["ideal_temp_max"]
                    ),
                    "max_temp_limit": float(
                        row["max_temp_limit"]
                    ),
                    "min_annual_rainfall": float(
                        row["min_annual_rainfall"]
                    ),
                    "min_soil_depth_cm": int(
                        float(row["min_soil_depth_cm"])
                    ),
                    "ideal_ph_min": float(
                        row["ideal_ph_min"]
                    ),
                    "ideal_ph_max": float(
                        row["ideal_ph_max"]
                    ),
                    "max_slope_pct": float(
                        row["max_slope_pct"]
                    ),
                }

                crop_key = name.casefold()
                existing_crop = existing_crops.get(crop_key)

                if existing_crop:
                    # Overwrite the existing crop values.
                    for field_name, value in crop_data.items():
                        setattr(existing_crop, field_name, value)

                    overwritten_count += 1

                else:
                    new_crop = Crop(**crop_data)
                    db.add(new_crop)

                    # Prevent duplicates if the same name appears again.
                    existing_crops[crop_key] = new_crop
                    inserted_count += 1

        db.commit()

        print("✅ Successfully imported crops from crop.csv!")
        print(f"   Inserted: {inserted_count}")
        print(f"   Overwritten: {overwritten_count}")

    except Exception as e:
        db.rollback()
        print(f"❌ Error importing crops: {e}")

    finally:
        db.close()


def fetch_open_meteo_elevation(lat, lng):
    """Fetches high-resolution local elevation from Open-Meteo."""
    try:
        url = f"https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lng}"
        res = requests.get(url, timeout=5)
        if res.status_code == 200:
            return res.json()["elevation"][0]
    except Exception as e:
        print(f"   ⚠️ Open-Meteo elevation error: {e}")
    return 150.0  # Fallback baseline

def fetch_nasa_agro_climate(lat, lng):
    """Fetches long-term agricultural climate parameters from NASA POWER."""
    # Default fallback values if the API fails or throttles
    fallbacks = {
        "root_zone_moisture": 0.50,
        "solar_radiation": 16.5,
        "annual_rainfall_mm": 2400.0
    }
    try:
        # Parameters: GWETROOT (Soil moisture), ALLSKY_SFC_SW_DWN (Solar), PRECTOTCORR (Rainfall)
        url = (
            f"https://power.larc.nasa.gov/api/temporal/climatology/point"
            f"?parameters=GWETROOT,ALLSKY_SFC_SW_DWN,PRECTOTCORR"
            f"&community=AG&longitude={lng}&latitude={lat}&format=JSON"
            f"&api_key={NASA_API_KEY}"
        )
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            metrics = data["properties"]["parameter"]
            
            # NASA returns 12 monthly climatology values. We calculate annual averages.
            avg_moisture = sum(metrics["GWETROOT"].values()) / 12.0
            avg_solar = sum(metrics["ALLSKY_SFC_SW_DWN"].values()) / 12.0
            
            # PRECTOTCORR is daily rainfall average per month. Multiply daily avg by 365.25 for annual total mm.
            daily_rain_avg = sum(metrics["PRECTOTCORR"].values()) / 12.0
            annual_rain = daily_rain_avg * 365.25
            
            return {
                "root_zone_moisture": round(avg_moisture, 3),
                "solar_radiation": round(avg_solar, 2),
                "annual_rainfall_mm": round(annual_rain, 1)
            }
    except Exception as e:
        print(f"   ⚠️ NASA POWER API error: {e}")
    
    return fallbacks

def seed_spatial_grids():
    db = SessionLocal()
    # 1. CLEAN THE TABLE COMPLETELY 
    print("🧹 Performing deep table truncation and resetting ID counters...")
    
    # This replaces db.query(SpatialGrid).delete()
    # It handles foreign keys (CASCADE) and resets auto-increment IDs to 1
    db.execute(text("TRUNCATE TABLE spatial_grids RESTART IDENTITY CASCADE;"))
    db.commit()
    print("✨ Table spatial_grids is now perfectly empty and reset.")

    # 2. THE NEW COMPREHENSIVE SABAH DATASET
    print("📡 Initiating Dual-API Harvester (Open-Meteo + NASA POWER)...")
    try:
        # Clean target tables to avoid mixing messy proxy data with authentic telemetry
        print("🧹 Clearing out old spatial grid entries...")
        db.query(SpatialGrid).delete()
        db.commit()

        print("📡 Initiating Dual-API Harvester (Open-Meteo + NASA POWER)...")

        sabah_anchors = [
            # West Coast Division (Bahagian Pantai Barat)
            {"name": "Kota Kinabalu", "lat": 5.9749, "lng": 116.0924},
            {"name": "Penampang", "lat": 5.9142, "lng": 116.1042},
            {"name": "Papar", "lat": 5.7333, "lng": 115.9333},
            {"name": "Tuaran", "lat": 6.1794, "lng": 116.2316},
            {"name": "Kota Belud", "lat": 6.3500, "lng": 116.4333},
            {"name": "Ranau", "lat": 5.9788, "lng": 116.5524},

            # Interior Division (Bahagian Pedalaman)
            {"name": "Keningau", "lat": 5.3333, "lng": 116.1667},
            {"name": "Tenom", "lat": 5.1167, "lng": 115.9500},
            {"name": "Tambunan", "lat": 5.6667, "lng": 116.3667},
            {"name": "Nabawan", "lat": 4.9833, "lng": 116.4167},
            {"name": "Beaufort", "lat": 5.3473, "lng": 115.7455},
            {"name": "Kuala Penyu", "lat": 5.5721, "lng": 115.5898},
            {"name": "Sipitang", "lat": 5.0833, "lng": 115.5500},

            # Sandakan Division (Bahagian Sandakan)
            {"name": "Sandakan", "lat": 5.8402, "lng": 118.1179},
            {"name": "Beluran", "lat": 6.0007, "lng": 117.5574},
            {"name": "Telupid", "lat": 5.6200, "lng": 117.1200},
            {"name": "Kinabatangan", "lat": 5.5333, "lng": 117.8500},
            {"name": "Tongod", "lat": 5.2631, "lng": 116.9634},

            # Tawau Division (Bahagian Tawau)
            {"name": "Tawau", "lat": 4.2447, "lng": 117.8912},
            {"name": "Lahad Datu", "lat": 5.0268, "lng": 118.3270},
            {"name": "Semporna", "lat": 4.4811, "lng": 118.6112},
            {"name": "Kunak", "lat": 4.6833, "lng": 118.2333},
            {"name": "Kalabakan", "lat": 4.4124, "lng": 117.4712},

            # Kudat Division (Bahagian Kudat)
            {"name": "Kudat", "lat": 6.8833, "lng": 116.8333},
            {"name": "Pitas", "lat": 6.7132, "lng": 117.0706},
            {"name": "Kota Marudu", "lat": 6.4951, "lng": 116.7644}
        ]

        spatial_records = []

        for district in sabah_anchors:
            print(f"\n🌍 Processing regional grid for: {district['name']}")
            
            # Generating 15 spatial rows spread around the district hub
            for i in range(15):
                lat = district["lat"] + random.uniform(-0.05, 0.05)
                lng = district["lng"] + random.uniform(-0.05, 0.05)
                
                # Call Engine 1: Open-Meteo
                elevation = fetch_open_meteo_elevation(lat, lng)
                
                # Call Engine 2: NASA POWER
                nasa_data = fetch_nasa_agro_climate(lat, lng)
                
                # Standard base soil values to complement weather features
                soil_ph = random.uniform(5.4, 6.8)
                slope = random.uniform(1.0, 20.0)
                soil_depth = random.randint(45, 125)

                spatial_records.append(SpatialGrid(
                    latitude=lat,
                    longitude=lng,
                    geom=WKTElement(f'POINT({lng} {lat})', srid=4326),
                    district=district["name"],
                    elevation_meters=elevation,
                    slope_pct=slope,
                    soil_depth_cm=soil_depth,
                    soil_ph=soil_ph,
                    annual_rainfall_mm=nasa_data["annual_rainfall_mm"],
                    solar_radiation=nasa_data["solar_radiation"],
                    root_zone_moisture=nasa_data["root_zone_moisture"]
                ))
                
                # Small rate-limit protection delay
                sleep(0.1)
                print(f"   ✅ Point {i+1}/15 logged (Elev: {elevation}m, Rain: {nasa_data['annual_rainfall_mm']}mm)")

        db.add_all(spatial_records)
        db.commit()
        print(f"\n🎉 Success! Seeded {len(spatial_records)} real agro-climate matrix samples across Sabah!")

    except Exception as e:
        db.rollback()
        print(f"❌ Critical failure during seeding pipeline: {e}")
    finally:
        db.close()

CROP_STATISTICS_CSV_FILENAME = "crop_statistics_2016_2024.csv"
CROP_STATISTICS_REQUIRED_COLUMNS = {
    "crop_name",
    "year",
    "planted_area_ha",
    "production_tonnes",
    "economic_value_myr",
    "district",
}


def resolve_crop_statistics_csv_path():
    """Find the crop-statistics CSV or use CROP_STATISTICS_CSV when provided."""
    return resolve_csv_path(
        CROP_STATISTICS_CSV_FILENAME,
        "CROP_STATISTICS_CSV",
        "Crop statistics",
    )


def parse_csv_number(value, field_name, row_number):
    """Convert a CSV number to float, treating blank values as zero."""
    text_value = str(value or "").strip().replace(",", "")
    if text_value.lower() in {"", "-", "n/a", "na", "null", "none"}:
        return 0.0

    try:
        number = float(text_value)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be numeric, got {value!r}") from exc

    if not math.isfinite(number):
        raise ValueError(f"{field_name} must be a finite number, got {value!r}")

    return number


def load_crop_statistics_csv(csv_path):
    """Read, validate, and deduplicate crop statistics from a CSV file."""
    records_by_key = {}
    invalid_rows = 0
    duplicate_rows = 0

    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        fieldnames = set(reader.fieldnames or [])
        missing_columns = CROP_STATISTICS_REQUIRED_COLUMNS - fieldnames
        if missing_columns:
            missing = ", ".join(sorted(missing_columns))
            raise ValueError(f"CSV is missing required column(s): {missing}")

        for row_number, row in enumerate(reader, start=2):
            try:
                crop_name = (row.get("crop_name") or "").strip()
                district = (row.get("district") or "").strip()
                year_text = (row.get("year") or "").strip()

                if not crop_name:
                    raise ValueError("crop_name is blank")
                if not district:
                    raise ValueError("district is blank")
                if not year_text:
                    raise ValueError("year is blank")

                try:
                    year = int(year_text)
                except ValueError as exc:
                    raise ValueError(f"year must be an integer, got {year_text!r}") from exc

                record = {
                    "crop_name": crop_name,
                    "year": year,
                    "planted_area_ha": parse_csv_number(
                        row.get("planted_area_ha"), "planted_area_ha", row_number
                    ),
                    "production_tonnes": parse_csv_number(
                        row.get("production_tonnes"), "production_tonnes", row_number
                    ),
                    "economic_value_myr": parse_csv_number(
                        row.get("economic_value_myr"), "economic_value_myr", row_number
                    ),
                    "district": district,
                    "source_row_number": row_number,
                }

                # Use a case-insensitive natural key. When the CSV contains the same
                # key more than once, keep the first occurrence so later zero rows do
                # not accidentally overwrite earlier populated values.
                natural_key = (crop_name.casefold(), year, district.casefold())
                if natural_key in records_by_key:
                    first_row = records_by_key[natural_key]["source_row_number"]
                    duplicate_rows += 1
                    print(
                        f"   ⚠️ CSV row {row_number} skipped: duplicate of row "
                        f"{first_row} for {crop_name} / {year} / {district}"
                    )
                    continue

                records_by_key[natural_key] = record

            except ValueError as exc:
                invalid_rows += 1
                print(f"   ⚠️ CSV row {row_number} skipped: {exc}")

    return records_by_key, invalid_rows, duplicate_rows


def numeric_values_match(current_value, csv_value):
    """Compare database numeric values with parsed CSV floats safely."""
    try:
        return math.isclose(
            float(current_value or 0),
            float(csv_value),
            rel_tol=1e-9,
            abs_tol=1e-9,
        )
    except (TypeError, ValueError):
        return False


def seed_doa_statistics():
    db = SessionLocal()
    try:
        csv_path = resolve_crop_statistics_csv_path()
        print(f"📄 Importing Sabah crop statistics from: {csv_path}")

        csv_records, invalid_rows, duplicate_rows = load_crop_statistics_csv(csv_path)

        # Load existing rows once instead of querying the database for every CSV row.
        existing_by_key = {}
        duplicate_database_rows = 0
        for existing_record in db.query(CropStatistic).all():
            natural_key = (
                str(existing_record.crop_name or "").strip().casefold(),
                int(existing_record.year),
                str(existing_record.district or "").strip().casefold(),
            )
            if natural_key in existing_by_key:
                duplicate_database_rows += 1
                print(
                    "   ⚠️ Existing database duplicate found for "
                    f"{existing_record.crop_name} / {existing_record.year} / "
                    f"{existing_record.district}; the first row will be updated."
                )
                continue
            existing_by_key[natural_key] = existing_record

        inserted_rows = 0
        updated_rows = 0
        unchanged_rows = 0

        for natural_key, csv_record in csv_records.items():
            existing_record = existing_by_key.get(natural_key)

            if existing_record is None:
                db.add(
                    CropStatistic(
                        crop_name=csv_record["crop_name"],
                        year=csv_record["year"],
                        planted_area_ha=csv_record["planted_area_ha"],
                        production_tonnes=csv_record["production_tonnes"],
                        economic_value_myr=csv_record["economic_value_myr"],
                        district=csv_record["district"],
                    )
                )
                inserted_rows += 1
                continue

            has_changes = (
                str(existing_record.crop_name or "").strip() != csv_record["crop_name"]
                or int(existing_record.year) != csv_record["year"]
                or not numeric_values_match(
                    existing_record.planted_area_ha,
                    csv_record["planted_area_ha"],
                )
                or not numeric_values_match(
                    existing_record.production_tonnes,
                    csv_record["production_tonnes"],
                )
                or not numeric_values_match(
                    existing_record.economic_value_myr,
                    csv_record["economic_value_myr"],
                )
                or str(existing_record.district or "").strip()
                != csv_record["district"]
            )

            if has_changes:
                existing_record.crop_name = csv_record["crop_name"]
                existing_record.year = csv_record["year"]
                existing_record.planted_area_ha = csv_record["planted_area_ha"]
                existing_record.production_tonnes = csv_record["production_tonnes"]
                existing_record.economic_value_myr = csv_record["economic_value_myr"]
                existing_record.district = csv_record["district"]
                updated_rows += 1
            else:
                unchanged_rows += 1

        db.commit()
        print("✔️ Crop statistics CSV import completed!")
        print(f"   Inserted: {inserted_rows}")
        print(f"   Updated: {updated_rows}")
        print(f"   Unchanged: {unchanged_rows}")
        print(f"   Invalid rows skipped: {invalid_rows}")
        print(f"   Duplicate CSV rows skipped: {duplicate_rows}")
        if duplicate_database_rows:
            print(f"   Existing database duplicates detected: {duplicate_database_rows}")

    except FileNotFoundError:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ Error importing crop statistics CSV: {e}")
        raise
    finally:
        db.close()

if __name__ == '__main__':
    print('will start to seed...')
    print('Seeding user table...')
    seed_user()
    print('User table seeded...')
    print('Seeding crop table...')
    seed_crops()
    print('Crop table seeded...')
    print('Seeding spatial grids table...')
    seed_spatial_grids()
    print('spatial grids table seeded...')
    print('Seeding crop statistics table...')
    seed_doa_statistics()
    print('crop statistics table seeded...')
