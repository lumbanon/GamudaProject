import os
import joblib
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..', 'ml_assets'))
MODEL_PATH = os.path.join(ASSETS_DIR, 'crop_classifier.joblib')
ENCODER_PATH = os.path.join(ASSETS_DIR, 'crop_encoder.joblib')

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
    if not os.path.exists(MODEL_PATH) or not os.path.exists(ENCODER_PATH):
        raise HTTPException(
            status_code=500,
            detail=f'machine learning engine assets missing on server path" {ASSETS_DIR}'
        )
    
    classifier = joblib.load(MODEL_PATH)
    encoder = joblib.load(ENCODER_PATH)

    try:
        crop_encoded = encoder.transform([data.crop_name])[0]
    except ValueError:
        raise HTTPException(status_code=400, detail=f'Crop target `{data.crop_name}` is unverified')
    
    input_df = pd.DataFrame([{
        'crop_encoded': crop_encoded,
        'elevation_meters': data.elevation_meters,
        'slope_pct': data.slope_pct,
        'soil_ph' : data.soil_ph,
        'soil_depth_cm': data.soil_depth_cm,
        'annual_rainfall_mm': data.annual_rainfall_mm,
        'solar_radiation': data.solar_radiation,
        'root_zone_moisture': data.root_zone_moisture
    }])

    prediction = classifier.predict(input_df)[0]
    probabilities = classifier.predict_proba(input_df)[0]
    classes = classifier.classes_

    prob_breakdown = {str(cls): round(float(prob) * 100, 2) for cls, prob in zip(classes, probabilities)}

    return {
        'status': 'success',
        'location': {
            'latitude': data.latitude,
            'longitude': data.longitude,
            'district': data.district
        },
        'crop': data.crop_name,
        'suitability' : prediction,
        'confidence_matrix' : prob_breakdown
    }
