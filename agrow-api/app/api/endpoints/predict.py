from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.services.prediction_service import (
    PredictionModelError,
    PredictionModelInputError,
    get_live_ecosystem_matrix,
    predict_suitability_with_model,
)

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
        'suitability': model_result['suitability_class'],
        'confidence_matrix': model_result['confidence_matrix'],
        'prediction_basis': 'model',
        'adjustment_reasons': [],
    }

@router.get("/live-matrix")
def read_live_ecosystem_matrix(
    db: Session = Depends(get_db),
):
    return get_live_ecosystem_matrix(db)
