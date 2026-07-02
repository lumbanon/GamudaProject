from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.prediction import CropOption, EnvironmentResponse, SuitabilityRequest, SuitabilityResponse
from app.services.prediction_service import (
    PredictionDataError,
    PredictionNotFoundError,
    get_available_crops,
    get_environment,
    get_suitability,
)


router = APIRouter()


@router.get("/crops", response_model=list[CropOption])
def read_prediction_crops(db: Session = Depends(get_db)):
    try:
        return get_available_crops(db)
    except PredictionDataError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/environment", response_model=EnvironmentResponse)
def read_prediction_environment(
    district: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    try:
        return get_environment(db, district=district)
    except PredictionDataError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.post("/suitability", response_model=SuitabilityResponse)
def create_prediction_suitability(payload: SuitabilityRequest, db: Session = Depends(get_db)):
    try:
        return get_suitability(db, payload)
    except PredictionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PredictionDataError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
