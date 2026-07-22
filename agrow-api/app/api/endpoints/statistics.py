from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.statistics import (
    CropStatisticsResponse,
    StatisticsOptionsResponse,
)
from app.services.statistics_service import (
    StatisticsDataError,
    StatisticsFilterError,
    get_crop_statistics,
    get_statistics_options,
    validate_statistics_filters,
)


router = APIRouter()


@router.get("/options", response_model=StatisticsOptionsResponse)
def read_statistics_options(db: Session = Depends(get_db)):
    try:
        return get_statistics_options(db)
    except StatisticsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@router.get("", response_model=CropStatisticsResponse)
def read_crop_statistics(
    crop_name: str | None = Query(default=None, max_length=100),
    district: str | None = Query(default=None, max_length=100),
    crop_names: list[str] | None = Query(default=None),
    districts: list[str] | None = Query(default=None),
    year: int | None = Query(default=None, ge=1900, le=2100),
    start_year: int | None = Query(default=None, ge=1900, le=2100),
    end_year: int | None = Query(default=None, ge=1900, le=2100),
    include_records: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    try:
        filters = validate_statistics_filters(
            crop_name=crop_name,
            district=district,
            crop_names=crop_names,
            districts=districts,
            year=year,
            start_year=start_year,
            end_year=end_year,
        )
        return get_crop_statistics(
            db,
            filters,
            include_records=include_records,
        )
    except StatisticsFilterError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except StatisticsDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
