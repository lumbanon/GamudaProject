import json
import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from geoalchemy2.elements import WKTElement
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.analysis_history import AnalysisHistory
from app.schemas.history import HistoryCreate


SORT_COLUMNS = {
    "created_at": AnalysisHistory.created_at,
    "updated_at": AnalysisHistory.updated_at,
    "name": AnalysisHistory.name,
    "crop": AnalysisHistory.selected_crop,
    "district": AnalysisHistory.district,
    "area": AnalysisHistory.land_area_hectares,
    "score": AnalysisHistory.suitability_score,
}

POLYGON_VALIDATION_SQL = text(
    """
    WITH candidate AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:polygon_geojson), 4326) AS geom
    )
    SELECT
        ST_IsValid(geom) AS is_valid,
        GeometryType(geom) AS geometry_type,
        ST_IsEmpty(geom) AS is_empty,
        ST_Area(geom::geography) AS area_m2,
        ST_AsGeoJSON(ST_Centroid(geom)) AS centroid_geojson
    FROM candidate
    """
)

BUILT_AREA_TERMS = (
    "built",
    "urban",
    "developed",
    "settlement",
    "residential",
    "commercial",
    "industrial",
)
REMOVED_CROP_KEYS = {"banana"}


def create_history(
    db: Session,
    *,
    user_id: int,
    payload: HistoryCreate,
    idempotency_key: str,
) -> dict[str, Any]:
    block_reason = history_save_block_reason(payload)
    if block_reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=block_reason,
        )

    existing = (
        db.query(AnalysisHistory)
        .filter(
            AnalysisHistory.user_id == user_id,
            AnalysisHistory.idempotency_key == idempotency_key,
        )
        .first()
    )
    if existing:
        return get_history(db, user_id=user_id, history_id=existing.id)

    polygon, area_hectares, centroid = validate_history_polygon(db, payload.boundary)
    values = payload.model_dump()
    record = AnalysisHistory(
        user_id=user_id,
        name=clean_optional_text(values["name"]),
        boundary=WKTElement(polygon_to_wkt(polygon), srid=4326),
        centroid=WKTElement(
            f"POINT({centroid['lon']} {centroid['lat']})",
            srid=4326,
        ),
        land_area_hectares=area_hectares,
        district=clean_optional_text(values["district"]),
        selected_crop=clean_optional_text(values["selected_crop"]),
        suitability_score=values["suitability_score"],
        confidence_level=clean_optional_text(values["confidence_level"]),
        environmental_data=values["environmental_data"],
        forest_reserve_result=values["forest_reserve_result"],
        land_cover_result=values["land_cover_result"],
        prediction_result=values["prediction_result"],
        yield_estimate=values["yield_estimate"],
        revenue_estimate=values["revenue_estimate"],
        risks=values["risks"],
        strengths=values["strengths"],
        missing_data=values["missing_data"],
        recommended_actions=values["recommended_actions"],
        gemini_insights=values["gemini_insights"],
        analysis_status=values["analysis_status"],
        dataset_snapshot=values["dataset_snapshot"],
        analysis_version=clean_optional_text(values["analysis_version"]),
        settings=values["settings"],
        idempotency_key=idempotency_key,
    )

    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except IntegrityError as exc:
        db.rollback()
        existing = (
            db.query(AnalysisHistory)
            .filter(
                AnalysisHistory.user_id == user_id,
                AnalysisHistory.idempotency_key == idempotency_key,
            )
            .first()
        )
        if existing:
            return get_history(db, user_id=user_id, history_id=existing.id)
        raise history_storage_error() from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc

    return get_history(db, user_id=user_id, history_id=record.id)


def history_save_block_reason(payload: HistoryCreate) -> str | None:
    selected_crop = str(payload.selected_crop or "").strip().casefold()
    if selected_crop in REMOVED_CROP_KEYS:
        return "The selected crop is no longer supported for prediction."

    forest = payload.forest_reserve_result or {}
    prediction = payload.prediction_result or {}
    if (
        forest.get("reserved_forest") is True
        or forest.get("allowed") is False
        or prediction.get("reserved_forest") is True
        or prediction.get("allowed") is False
    ):
        return "Analyses inside a forest reserve cannot be saved."

    land_cover = payload.land_cover_result or {}
    satellite = land_cover.get("satellite_building_analysis") or {}
    land_cover_value = str(land_cover.get("land_cover") or "").strip().lower()
    is_materially_built_area = (
        satellite.get("is_built_up") is True
        or satellite.get("land_cover_override_recommended") is True
        or (
            land_cover_value
            and any(term in land_cover_value for term in BUILT_AREA_TERMS)
        )
    )
    gemini_insight = payload.gemini_insights or prediction.get("genai_insight")
    if is_materially_built_area and not has_usable_gemini_insight(gemini_insight):
        return (
            "Analyses of materially built-up areas require a generated Gemini insight "
            "before they can be saved."
        )

    return None


def has_usable_gemini_insight(insight: Any) -> bool:
    if not isinstance(insight, dict) or insight.get("fallback_used") is True:
        return False

    fields = (
        insight.get("crop_suitability_summary"),
        insight.get("key_strengths"),
        insight.get("potential_risks"),
        insight.get("recommended_actions"),
    )
    return any(has_meaningful_insight_value(value) for value in fields)


def has_meaningful_insight_value(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(has_meaningful_insight_value(item) for item in value)
    return False


def list_history(
    db: Session,
    *,
    user_id: int,
    search: str | None,
    crop: str | None,
    district: str | None,
    date_from: date | None,
    date_to: date | None,
    min_score: float | None,
    max_score: float | None,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: str,
) -> dict[str, Any]:
    query = db.query(AnalysisHistory).filter(
        AnalysisHistory.user_id == user_id,
        or_(
            AnalysisHistory.selected_crop.is_(None),
            func.lower(func.trim(AnalysisHistory.selected_crop)).notin_(REMOVED_CROP_KEYS),
        ),
    )
    if search:
        query = query.filter(AnalysisHistory.name.ilike(f"%{search.strip()}%"))
    if crop:
        query = query.filter(AnalysisHistory.selected_crop == crop)
    if district:
        query = query.filter(AnalysisHistory.district == district)
    if date_from:
        query = query.filter(
            AnalysisHistory.created_at >= datetime.combine(
                date_from,
                time.min,
                tzinfo=timezone.utc,
            )
        )
    if date_to:
        exclusive_end = datetime.combine(
            date_to,
            time.min,
            tzinfo=timezone.utc,
        ) + timedelta(days=1)
        query = query.filter(AnalysisHistory.created_at < exclusive_end)
    if min_score is not None:
        query = query.filter(AnalysisHistory.suitability_score >= min_score)
    if max_score is not None:
        query = query.filter(AnalysisHistory.suitability_score <= max_score)

    try:
        total = query.count()
        sort_column = SORT_COLUMNS.get(sort_by, AnalysisHistory.created_at)
        order_expression = (
            sort_column.asc().nulls_last()
            if sort_order == "asc"
            else sort_column.desc().nulls_last()
        )
        records = (
            query.order_by(order_expression, AnalysisHistory.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        items = [serialize_history(db, record) for record in records]
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": math.ceil(total / page_size) if total else 0,
    }


def get_history(
    db: Session,
    *,
    user_id: int,
    history_id: UUID,
) -> dict[str, Any]:
    try:
        record = (
            db.query(AnalysisHistory)
            .filter(
                AnalysisHistory.id == history_id,
                AnalysisHistory.user_id == user_id,
                or_(
                    AnalysisHistory.selected_crop.is_(None),
                    func.lower(func.trim(AnalysisHistory.selected_crop)).notin_(REMOVED_CROP_KEYS),
                ),
            )
            .first()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis history record was not found.",
        )
    return serialize_history(db, record)


def update_history_name(
    db: Session,
    *,
    user_id: int,
    history_id: UUID,
    name: str | None,
) -> dict[str, Any]:
    record = owned_history_record(db, user_id=user_id, history_id=history_id)
    record.name = clean_optional_text(name)
    try:
        db.commit()
        db.refresh(record)
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc
    return serialize_history(db, record)


def delete_history(db: Session, *, user_id: int, history_id: UUID) -> None:
    record = owned_history_record(db, user_id=user_id, history_id=history_id)
    try:
        db.delete(record)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc


def restore_history(
    db: Session,
    *,
    user_id: int,
    history_id: UUID,
) -> dict[str, Any]:
    record = get_history(db, user_id=user_id, history_id=history_id)
    return {
        "history_id": record["id"],
        "boundary": record["boundary"],
        "selected_crop": record["selected_crop"],
        "district": record["district"],
        "source_analysis_date": record["created_at"],
        "saved_results": {
            "environmental_data": record["environmental_data"],
            "forest_reserve_result": record["forest_reserve_result"],
            "land_cover_result": record["land_cover_result"],
            "prediction_result": record["prediction_result"],
            "yield_estimate": record["yield_estimate"],
            "revenue_estimate": record["revenue_estimate"],
            "risks": record["risks"],
            "strengths": record["strengths"],
            "missing_data": record["missing_data"],
            "recommended_actions": record["recommended_actions"],
            "gemini_insights": record["gemini_insights"],
            "dataset_snapshot": record["dataset_snapshot"],
        },
    }


def validate_history_polygon(
    db: Session,
    boundary: list[list[float]],
) -> tuple[list[list[float]], float, dict[str, float]]:
    polygon = normalize_polygon(boundary)
    polygon_geojson = {
        "type": "Polygon",
        "coordinates": [polygon],
    }
    try:
        row = (
            db.execute(
                POLYGON_VALIDATION_SQL,
                {"polygon_geojson": json.dumps(polygon_geojson)},
            )
            .mappings()
            .first()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc

    area_m2 = float(row["area_m2"] or 0) if row else 0
    if (
        not row
        or not row["is_valid"]
        or row["is_empty"]
        or row["geometry_type"] != "POLYGON"
        or area_m2 <= 0
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Boundary must be a valid, non-self-intersecting polygon.",
        )

    centroid_geojson = row["centroid_geojson"]
    if isinstance(centroid_geojson, str):
        centroid_geojson = json.loads(centroid_geojson)
    centroid_coordinates = centroid_geojson.get("coordinates", [])
    if len(centroid_coordinates) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Boundary centroid could not be calculated.",
        )

    return (
        polygon,
        round(area_m2 / 10000, 4),
        {
            "lon": float(centroid_coordinates[0]),
            "lat": float(centroid_coordinates[1]),
        },
    )


def normalize_polygon(boundary: list[list[float]]) -> list[list[float]]:
    if not isinstance(boundary, list) or len(boundary) < 3 or len(boundary) > 1001:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Boundary must contain between 3 and 1,000 points.",
        )

    normalized: list[list[float]] = []
    for point in boundary:
        if not isinstance(point, list) or len(point) != 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Each boundary point must contain longitude and latitude.",
            )
        try:
            longitude = float(point[0])
            latitude = float(point[1])
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Boundary coordinates must be numeric.",
            ) from exc
        if (
            not math.isfinite(longitude)
            or not math.isfinite(latitude)
            or longitude < -180
            or longitude > 180
            or latitude < -90
            or latitude > 90
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Boundary coordinates are outside longitude/latitude limits.",
            )
        normalized.append([longitude, latitude])

    if normalized[0] != normalized[-1]:
        normalized.append(normalized[0])
    if len({tuple(point) for point in normalized[:-1]}) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Boundary must contain at least three unique points.",
        )
    return normalized


def owned_history_record(
    db: Session,
    *,
    user_id: int,
    history_id: UUID,
) -> AnalysisHistory:
    try:
        record = (
            db.query(AnalysisHistory)
            .filter(
                AnalysisHistory.id == history_id,
                AnalysisHistory.user_id == user_id,
            )
            .first()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis history record was not found.",
        )
    return record


def serialize_history(db: Session, record: AnalysisHistory) -> dict[str, Any]:
    try:
        boundary_geojson, centroid_geojson = (
            db.query(
                func.ST_AsGeoJSON(record.boundary),
                func.ST_AsGeoJSON(record.centroid),
            )
            .one()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise history_storage_error() from exc

    boundary_geometry = json.loads(boundary_geojson)
    centroid_geometry = json.loads(centroid_geojson)
    centroid_coordinates = centroid_geometry.get("coordinates", [])
    return {
        "id": record.id,
        "name": record.name,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "boundary": boundary_geometry.get("coordinates", [[]])[0],
        "centroid": {
            "lon": float(centroid_coordinates[0]),
            "lat": float(centroid_coordinates[1]),
        },
        "land_area_hectares": float(record.land_area_hectares),
        "district": record.district,
        "selected_crop": record.selected_crop,
        "suitability_score": (
            float(record.suitability_score)
            if record.suitability_score is not None
            else None
        ),
        "confidence_level": record.confidence_level,
        "environmental_data": record.environmental_data or {},
        "forest_reserve_result": record.forest_reserve_result,
        "land_cover_result": record.land_cover_result,
        "prediction_result": record.prediction_result or {},
        "yield_estimate": record.yield_estimate,
        "revenue_estimate": record.revenue_estimate,
        "risks": record.risks or [],
        "strengths": record.strengths or [],
        "missing_data": record.missing_data or [],
        "recommended_actions": record.recommended_actions or [],
        "gemini_insights": record.gemini_insights,
        "analysis_status": record.analysis_status,
        "dataset_snapshot": record.dataset_snapshot or {},
        "analysis_version": record.analysis_version,
        "settings": record.settings or {},
    }


def polygon_to_wkt(polygon: list[list[float]]) -> str:
    coordinates = ", ".join(f"{longitude} {latitude}" for longitude, latitude in polygon)
    return f"POLYGON(({coordinates}))"


def clean_optional_text(value: object) -> str | None:
    text_value = str(value).strip() if value is not None else ""
    return text_value or None


def history_storage_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Analysis history storage is temporarily unavailable.",
    )
