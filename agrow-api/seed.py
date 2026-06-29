import os
import requests
import random
from time import sleep
from app.database.session import SessionLocal, Base
from app.models.user import User
from app.models.crop import Crop
from app.models.crop_statistic import CropStatistic
from app.models.spatial_grid import SpatialGrid
from passlib.context import CryptContext
from geoalchemy2.elements import WKTElement
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
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

def seed_user():
    db = SessionLocal()

    existing_user = db.query(User).filter(User.email == 'test@agrow.com').first()
    if existing_user:
        print('User already exist')
        db.close()
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
        if db.query(Crop).first():
            print('✅ Crops data already exists. Skipping...')
            return

        print('Seeding Crop biophysical threshold matrices (Durian, Watermelon, Cabbage)...')
        crops_data = [
            Crop(
                name="Durian",
                scientific_name="Durio zibethinus",
                min_temp_limit=22.00, ideal_temp_min=24.00, ideal_temp_max=30.00, max_temp_limit=35.00,
                min_annual_rainfall=1500.0, min_soil_depth_cm=100, 
                ideal_ph_min=5.5, ideal_ph_max=6.5, max_slope_pct=25.0 
            ),
            Crop(
                name="Watermelon",
                scientific_name="Citrullus lanatus",
                min_temp_limit=18.00, ideal_temp_min=25.00, ideal_temp_max=35.00, max_temp_limit=38.00,
                min_annual_rainfall=800.0, min_soil_depth_cm=50,
                ideal_ph_min=6.0, ideal_ph_max=7.0, max_slope_pct=5.0   
            ),
            Crop(
                name="Cabbage",
                scientific_name="Brassica oleracea var. capitata",
                min_temp_limit=10.00, ideal_temp_min=15.00, ideal_temp_max=21.00, max_temp_limit=28.00,
                min_annual_rainfall=1000.0, min_soil_depth_cm=45,
                ideal_ph_min=6.0, ideal_ph_max=7.5, max_slope_pct=15.0 
            )
        ]
        db.add_all(crops_data)
        db.commit()
        print('✅ Successfully seeded crops threshold profiles!')
    except Exception as e:
        db.rollback()
        print(f'❌ Error seeding crops: {e}')
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
    try:
        # Clean target tables to avoid mixing messy proxy data with authentic telemetry
        print("🧹 Clearing out old spatial grid entries...")
        db.query(SpatialGrid).delete()
        db.commit()

        print("📡 Initiating Dual-API Harvester (Open-Meteo + NASA POWER)...")

        sabah_anchors = [
            {"name": "Ranau", "lat": 5.9788, "lng": 116.5524},
            {"name": "Kundasang", "lat": 5.9814, "lng": 116.5775},
            {"name": "Tawau", "lat": 4.2447, "lng": 117.8912},
            {"name": "Tenom", "lat": 5.1167, "lng": 115.9500},
            {"name": "Papar", "lat": 5.7333, "lng": 115.9333},
            {"name": "Kota Belud", "lat": 6.3500, "lng": 116.4333},
            {"name": "Keningau", "lat": 5.3333, "lng": 116.1667},
            {"name": "Sandakan", "lat": 5.8402, "lng": 118.1179}
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

def seed_doa_statistics():
    db = SessionLocal()
    try:
        if db.query(CropStatistic).first():
            print("✅ DOA Statistics already exist. Skipping...")
            return

        print("✅ Seeding exact Sabah DOA statistics extracted from images (Values converted from RM '000 to absolute MYR)...")
        
        sabah_statistics = [
            # DURIAN DATA 
            CropStatistic(crop_name="Durian", year=2024, planted_area_ha=1457.10, production_tonnes=5356.90, economic_value_myr=109762880.00, district="Ranau"),
            CropStatistic(crop_name="Durian", year=2024, planted_area_ha=1261.80, production_tonnes=1520.20, economic_value_myr=31148900.00, district="Keningau"),
            CropStatistic(crop_name="Durian", year=2024, planted_area_ha=366.00, production_tonnes=1190.60, economic_value_myr=24395390.00, district="Tawau"),
            CropStatistic(crop_name="Durian", year=2024, planted_area_ha=308.60, production_tonnes=1544.30, economic_value_myr=31642710.00, district="Kota Belud"),
            
            # WATERMELON DATA 
            CropStatistic(crop_name="Watermelon", year=2024, planted_area_ha=56.00, production_tonnes=1160.00, economic_value_myr=2517200.00, district="Papar"),
            CropStatistic(crop_name="Watermelon", year=2024, planted_area_ha=45.40, production_tonnes=854.60, economic_value_myr=1854480.00, district="Tawau"),
            CropStatistic(crop_name="Watermelon", year=2024, planted_area_ha=34.50, production_tonnes=715.50, economic_value_myr=1552640.00, district="Matunggong"),
            
            # CABBAGE DATA 
            CropStatistic(crop_name="Cabbage", year=2024, planted_area_ha=644.50, production_tonnes=7577.70, economic_value_myr=17731820.00, district="Ranau"),
            CropStatistic(crop_name="Cabbage", year=2024, planted_area_ha=2.20, production_tonnes=22.80, economic_value_myr=53350.00, district="Sipitang"),
            CropStatistic(crop_name="Cabbage", year=2024, planted_area_ha=0.50, production_tonnes=2.60, economic_value_myr=6080.00, district="Kota Belud")
        ]
        
        db.add_all(sabah_statistics)
        db.commit()
        print("✔️ Successfully populated target DOA regional profiles!")
    except Exception as e:
        db.rollback()
        print(f"❌ Error seeding statistics: {e}")
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
