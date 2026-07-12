import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session


logger = logging.getLogger(__name__)

RESERVED_FOREST_MESSAGE = "Selected area is inside a reserved forest. You are not allowed to plant here."
FOREST_RESERVE_CHECK_WARNING = (
    "Forest reserve validation is unavailable; continuing without the protected land check."
)

FOREST_RESERVE_OVERLAP_SQL = """
WITH selected_area AS (
    SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(:polygon_geojson), 4326)) AS geom
),
forest_reserves_4326 AS (
    SELECT
        CASE
            WHEN (
                ST_XMin(Box2D(fr.geom)) < -180
                OR ST_XMax(Box2D(fr.geom)) > 180
                OR ST_YMin(Box2D(fr.geom)) < -90
                OR ST_YMax(Box2D(fr.geom)) > 90
            ) THEN ST_MakeValid(ST_Transform(ST_SetSRID(fr.geom, 3857), 4326))
            WHEN ST_SRID(fr.geom) = 4326 THEN ST_MakeValid(fr.geom)
            WHEN ST_SRID(fr.geom) = 0 THEN ST_SetSRID(ST_MakeValid(fr.geom), 4326)
            ELSE ST_MakeValid(ST_Transform(fr.geom, 4326))
        END AS geom
    FROM public.forest_reserves fr
    WHERE fr.geom IS NOT NULL
),
intersecting_reserves AS (
    SELECT
        ST_CollectionExtract(ST_MakeValid(fr.geom), 3) AS reserve_geom,
        ST_CollectionExtract(
            ST_MakeValid(ST_Intersection(fr.geom, selected_area.geom)),
            3
        ) AS overlap_geom
    FROM forest_reserves_4326 fr
    CROSS JOIN selected_area
    WHERE ST_Intersects(fr.geom, selected_area.geom)
)
SELECT
    EXISTS (SELECT 1 FROM intersecting_reserves) AS is_reserved_forest,
    COALESCE(
        SUM(
            CASE
                WHEN NOT ST_IsEmpty(overlap_geom) THEN ST_Area(overlap_geom::geography)
                ELSE 0
            END
        ),
        0
    )::double precision AS reserved_overlap_m2,
    jsonb_build_object(
        'type',
        'FeatureCollection',
        'features',
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'type',
                    'Feature',
                    'properties',
                    jsonb_build_object('source', 'forest_reserve'),
                    'geometry',
                    ST_AsGeoJSON(reserve_geom)::jsonb
                )
            ) FILTER (WHERE NOT ST_IsEmpty(reserve_geom)),
            '[]'::jsonb
        )
    ) AS reserved_forest_geojson,
    jsonb_build_object(
        'type',
        'FeatureCollection',
        'features',
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'type',
                    'Feature',
                    'properties',
                    jsonb_build_object('source', 'forest_reserve'),
                    'geometry',
                    ST_AsGeoJSON(overlap_geom)::jsonb
                )
            ) FILTER (WHERE NOT ST_IsEmpty(overlap_geom)),
            '[]'::jsonb
        )
    ) AS reserved_overlap_geojson
FROM intersecting_reserves;
"""


def validate_forest_reserve_overlap(db: Session, polygon: list[list[float]] | None) -> dict[str, Any]:
    if not polygon:
        return allowed_result()

    try:
        polygon_geojson = json.dumps(polygon_to_geojson_geometry(polygon))
        row = (
            db.execute(
                text(FOREST_RESERVE_OVERLAP_SQL),
                {"polygon_geojson": polygon_geojson},
            )
            .mappings()
            .first()
        )
    except (SQLAlchemyError, ValueError, TypeError) as exc:
        if isinstance(exc, SQLAlchemyError):
            db.rollback()
        logger.exception("Unable to validate selected area against public.forest_reserves.")
        return allowed_result(forest_reserve_check_warning=FOREST_RESERVE_CHECK_WARNING)

    is_reserved_forest = bool(row and row["is_reserved_forest"])
    reserved_overlap_m2 = round(coerce_float(row["reserved_overlap_m2"]) or 0.0, 2) if row else 0.0
    reserved_forest_geojson = row["reserved_forest_geojson"] if row and is_reserved_forest else None
    reserved_overlap_geojson = row["reserved_overlap_geojson"] if row and is_reserved_forest else None

    if is_reserved_forest:
        return {
            "allowed": False,
            "reserved_forest": True,
            "blocked_reason": "reserved_forest",
            "message": RESERVED_FOREST_MESSAGE,
            "reserved_overlap_m2": reserved_overlap_m2,
            "reserved_forest_geojson": reserved_forest_geojson,
            "reserved_overlap_geojson": reserved_overlap_geojson,
        }

    return {
        **allowed_result(),
        "reserved_overlap_m2": reserved_overlap_m2,
    }


def allowed_result(forest_reserve_check_warning: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "allowed": True,
        "reserved_forest": False,
        "blocked_reason": None,
        "message": None,
        "reserved_overlap_m2": 0.0,
        "reserved_forest_geojson": None,
        "reserved_overlap_geojson": None,
    }
    if forest_reserve_check_warning:
        result["forest_reserve_check_warning"] = forest_reserve_check_warning
    return result


def polygon_to_geojson_geometry(polygon: list[list[float]]) -> dict[str, Any]:
    if len(polygon) < 3:
        raise ValueError("A polygon needs at least three coordinates.")

    coordinates = [[coerce_longitude(lon), coerce_latitude(lat)] for lon, lat in polygon]
    if coordinates[0] != coordinates[-1]:
        coordinates.append(coordinates[0])

    return {
        "type": "Polygon",
        "coordinates": [coordinates],
    }


def coerce_longitude(value: object) -> float:
    coordinate = float(value)
    if not -180 <= coordinate <= 180:
        raise ValueError("Polygon longitude is outside EPSG:4326 bounds.")
    return coordinate


def coerce_latitude(value: object) -> float:
    coordinate = float(value)
    if not -90 <= coordinate <= 90:
        raise ValueError("Polygon latitude is outside EPSG:4326 bounds.")
    return coordinate


def coerce_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
