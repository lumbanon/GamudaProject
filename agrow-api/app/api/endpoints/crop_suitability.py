import math

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.services.crop_suitability_service import (
    SUPPORTED_CROPS,
    analyze_crop_area,
    canonical_crop_name,
)


router = APIRouter()


class AnalyzeAreaRequest(BaseModel):
    crop: str | None = None
    polygon: list[list[float]] | None = None


@router.post("/analyze-area")
def analyze_area(payload: AnalyzeAreaRequest, db: Session = Depends(get_db)):
    crop = canonical_crop_name(payload.crop)
    if not crop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported crop. Supported crops: {', '.join(SUPPORTED_CROPS)}",
        )

    try:
        polygon = validate_polygon(payload.polygon)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return analyze_crop_area(db, crop, polygon)


def validate_polygon(polygon: list[list[float]]) -> list[list[float]]:
    if not isinstance(polygon, list) or not polygon:
        raise ValueError("polygon is required and must be a list of [longitude, latitude] coordinates")

    normalized = []
    for index, point in enumerate(polygon):
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError(f"polygon point {index + 1} must be [longitude, latitude]")

        lon, lat = point
        if not is_finite_number(lon) or not is_finite_number(lat):
            raise ValueError(f"polygon point {index + 1} contains invalid coordinates")

        lon = float(lon)
        lat = float(lat)
        if lon < -180 or lon > 180 or lat < -90 or lat > 90:
            raise ValueError(f"polygon point {index + 1} must use valid longitude/latitude values")

        normalized.append([lon, lat])

    unique_points = {tuple(point) for point in normalized}
    if len(unique_points) < 3:
        raise ValueError("polygon must contain at least 3 unique points")

    if normalized[0] != normalized[-1]:
        normalized.append(normalized[0])

    return normalized


def is_finite_number(value) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False
