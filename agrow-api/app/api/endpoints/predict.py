import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine, text

from app.services.prediction_service import (
    PredictionModelError,
    PredictionModelInputError,
    apply_simulator_ph_guardrail,
    predict_suitability_with_model,
)

DB_USER='postgres'
DB_PASSWORD= os.getenv("DATABASE_PASSWORD")
DB_HOST='localhost'
DB_PORT='5432'
DB_NAME='agrow_db'

DATABASE_URL=f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(DATABASE_URL)

router = APIRouter()

class PredictionInput(BaseModel):
    crop_name: str
    latitude: float
    longitude: float
    district: str | None = None
    elevation_meters: float
    slope_pct: float
    soil_ph: float
    soil_depth_cm: int
    annual_rainfall_mm: float
    solar_radiation: float
    root_zone_moisture: float

@router.post('/suitability')
def predict_crop_suitability(data: PredictionInput):
    try:
        model_result = predict_suitability_with_model(
            data.crop_name,
            {
                'elevation_meters': data.elevation_meters,
                'slope_pct': data.slope_pct,
                'soil_ph': data.soil_ph,
                'soil_depth_cm': data.soil_depth_cm,
                'annual_rainfall_mm': data.annual_rainfall_mm,
                'solar_radiation': data.solar_radiation,
                'root_zone_moisture': data.root_zone_moisture,
            },
        )
        prediction_result = apply_simulator_ph_guardrail(
            data.crop_name,
            data.soil_ph,
            model_result,
        )
    except PredictionModelInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PredictionModelError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        'status': 'success',
        'location': {
            'latitude': data.latitude,
            'longitude': data.longitude,
            'district': data.district
        },
        'crop': data.crop_name,
        'suitability': prediction_result['suitability_class'],
        'confidence_matrix': prediction_result['confidence_matrix'],
        'prediction_basis': prediction_result['prediction_basis'],
        'adjustment_reasons': prediction_result['adjustment_reasons'],
    }

@router.get("/live-matrix")
def get_live_ecosystem_matrix():
    try:
        with engine.connect() as conn:
            # 1. Fetch real environmental data aggregated by district
            grid_query = text("""
                SELECT 
                    district,
                    AVG(latitude) as lat,
                    AVG(longitude) as lng,
                    ROUND(AVG(elevation_meters)::numeric, 1) as elev,
                    ROUND(AVG(slope_pct)::numeric, 1) as slope,
                    ROUND(AVG(soil_ph)::numeric, 1) as ph,
                    ROUND(AVG(soil_depth_cm)::numeric, 0) as depth,
                    ROUND(AVG(annual_rainfall_mm)::numeric, 1) as rain,
                    ROUND(AVG(solar_radiation)::numeric, 2) as solar,
                    ROUND(AVG(root_zone_moisture)::numeric, 2) as moisture
                FROM spatial_grids
                GROUP BY district;
            """)
            grid_rows = conn.execute(grid_query).fetchall()

            # 2. Fetch official crop metrics
            crop_query = text("SELECT name FROM crops;")
            crop_rows = conn.execute(crop_query).fetchall()

        # Format into a clean structured JSON payload for React
        district_matrix = {
            row._mapping["district"]: {
                "lat": float(row._mapping["lat"]),
                "lng": float(row._mapping["lng"]),
                "elev": float(row._mapping["elev"]),
                "slope": float(row._mapping["slope"]),
                "ph": float(row._mapping["ph"]),
                "depth": int(row._mapping["depth"]),
                "rain": float(row._mapping["rain"]),
                "solar": float(row._mapping["solar"]),
                "moisture": float(row._mapping["moisture"])
            }
            for row in grid_rows
        }

        crop_list = [row._mapping["name"] for row in crop_rows]

        # If DB hasn't been seeded yet, send a structural fallback message
        if not district_matrix:
            return {"status": "empty", "message": "Database tables are empty. Run seed.py first."}

        return {
            "status": "success",
            "districts": district_matrix,
            "crops": crop_list
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connectivity failure: {str(e)}")
