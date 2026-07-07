import math
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.crop import Crop
from app.models.crop_statistic import CropStatistic
from app.services.crop_suitability_service import CROP_REQUIREMENTS
from app.services.forest_reserve_service import validate_forest_reserve_overlap
from app.services.gemini_insight_service import build_gemini_ai_insight


class PredictionNotFoundError(Exception):
    pass


class PredictionDataError(Exception):
    pass


@dataclass
class CropThreshold:
    id: int | None
    name: str
    scientific_name: str | None
    min_temp_limit: float
    ideal_temp_min: float
    ideal_temp_max: float
    max_temp_limit: float
    min_annual_rainfall: float
    min_soil_depth_cm: int
    ideal_ph_min: float
    ideal_ph_max: float
    max_slope_pct: float


FALLBACK_SCIENTIFIC_NAMES = {
    "Banana": "Musa spp.",
    "Cocoa": "Theobroma cacao",
    "Corn": "Zea mays",
    "Rice": "Oryza sativa",
    "Durian": "Durio zibethinus",
    "Pineapple": "Ananas comosus",
    "Oil Palm": "Elaeis guineensis",
}


NUMERIC_ENV_COLUMNS = (
    ("annual_rainfall_mm", "rainfall_mm"),
    ("rainfall_mm", "rainfall_mm"),
    ("temperature_c", "temperature_c"),
    ("avg_temperature_c", "temperature_c"),
    ("soil_ph", "soil_ph"),
    ("nitrogen", "nitrogen"),
    ("nitrogen_pct", "nitrogen"),
    ("soc", "soc"),
    ("soil_organic_carbon", "soc"),
    ("organic_carbon", "organic_carbon"),
    ("organic_carbon_pct", "organic_carbon"),
    ("clay", "clay_pct"),
    ("clay_pct", "clay_pct"),
    ("sand", "sand_pct"),
    ("sand_pct", "sand_pct"),
    ("dem", "dem_m"),
    ("dem_m", "dem_m"),
    ("elevation_meters", "elevation_m"),
    ("elevation_m", "elevation_m"),
    ("slope_pct", "slope_pct"),
    ("soil_depth_cm", "soil_depth_cm"),
    ("solar_radiation", "solar_radiation"),
    ("root_zone_moisture", "root_zone_moisture"),
)

TEXT_ENV_COLUMNS = (
    ("land_cover", "land_cover"),
    ("landcover", "land_cover"),
)

ENVIRONMENT_RESPONSE_FIELDS = (
    "rainfall_mm",
    "temperature_c",
    "soil_ph",
    "nitrogen",
    "soc",
    "organic_carbon",
    "clay_pct",
    "sand_pct",
    "dem_m",
    "elevation_m",
    "slope_pct",
    "slope_deg",
    "soil_depth_cm",
    "land_cover",
    "solar_radiation",
    "root_zone_moisture",
)

ESSENTIAL_SCORE_FIELDS = ("rainfall_mm", "temperature_c", "soil_ph", "soil_depth_cm", "slope_pct")

SCORE_WEIGHTS = {
    "rainfall_mm": 20,
    "temperature_c": 22,
    "soil_ph": 20,
    "soil_depth_cm": 16,
    "slope_pct": 16,
    "organic_matter": 6,
}

RASTER_LAYERS = {
    "rainfall_mm": {"table": "rainfall_annual", "scale": 1.0, "zero_is_nodata": False},
    "temperature_c": {"table": "temperature_annual", "scale": 1.0, "zero_is_nodata": False},
    "soil_ph": {"table": "phh2o_0_5cm", "scale": 0.1, "zero_is_nodata": True},
    "nitrogen": {"table": "nitrogen_0_5cm", "scale": 0.001, "zero_is_nodata": True},
    "soc": {"table": "soc_0_5cm", "scale": 0.01, "zero_is_nodata": True},
    "clay_pct": {"table": "clay_0_5cm", "scale": 0.1, "zero_is_nodata": True},
    "sand_pct": {"table": "sand_0_5cm", "scale": 0.1, "zero_is_nodata": True},
    "dem_m": {"table": "dem", "scale": 1.0, "zero_is_nodata": False},
    "land_cover": {"table": "land_cover", "scale": 1.0, "zero_is_nodata": True},
}

LAND_COVER_LABELS = {
    10: "tree cover",
    20: "shrubland",
    30: "grassland",
    40: "cropland",
    50: "built-up",
    60: "bare/sparse vegetation",
    70: "snow and ice",
    80: "water",
    90: "wetland",
    95: "mangrove",
    100: "moss and lichen",
}


def get_available_crops(db: Session) -> list[dict]:
    try:
        crops = db.query(Crop).order_by(func.lower(Crop.name)).all()
    except SQLAlchemyError:
        db.rollback()
        crops = []

    if crops:
        return [crop_to_dict(crop) for crop in crops]

    legacy_crops = get_legacy_crop_options(db)
    if legacy_crops:
        return legacy_crops

    return [crop_to_dict(build_fallback_crop_threshold(name)) for name in CROP_REQUIREMENTS]


def get_environment(db: Session, district: str | None = None) -> dict:
    environment = query_environment_values(db, district=district)
    return {
        "district": district,
        "sample_count": environment["sample_count"],
        "values": environment["values"],
        "available_districts": get_available_districts(db),
    }


def get_suitability(db: Session, request) -> dict:
    forest_reserve_check = validate_forest_reserve_overlap(db, request.polygon)
    if forest_reserve_check["allowed"] is False:
        return {
            **forest_reserve_check,
            "crop": request.crop,
            "district": request.district,
            "area_hectares": calculate_polygon_area_hectares(request.polygon) if request.polygon else None,
        }

    crop = get_crop_by_name(db, request.crop)
    if not crop:
        raise PredictionNotFoundError(f"Crop '{request.crop}' was not found in the crops table.")

    environment = query_environment_values(
        db,
        district=request.district,
        polygon=request.polygon,
        user_inputs=request.user_inputs,
    )

    if environment["sample_count"] == 0 and not request.user_inputs:
        location = f"district '{request.district}'" if request.district else "the selected area"
        raise PredictionNotFoundError(f"No environmental records were found for {location}.")

    area_hectares = calculate_polygon_area_hectares(request.polygon) if request.polygon else None
    suitability = score_crop_suitability(crop, environment["values"], environment["sample_count"])
    explanation = build_explanation(crop, request.district, environment, suitability)
    estimate = build_return_estimate(db, crop.name, suitability["score"], area_hectares)
    planting_window = build_planting_window(environment["values"])
    genai_insight = build_gemini_ai_insight(
        crop=crop,
        district=request.district,
        area_hectares=area_hectares,
        environment=environment,
        suitability=suitability,
        recommendations=suitability["recommendations"],
        planting_window=planting_window,
        return_estimate=estimate,
        fallback=explanation,
    )
    ai_insight = genai_insight.get("crop_suitability_summary") or explanation

    return {
        **forest_reserve_check,
        "crop": crop.name,
        "district": request.district,
        "area_hectares": area_hectares,
        "suitability_score": suitability["score"],
        "matched_environment": environment["values"],
        "features": environment["values"],
        "suitability": suitability,
        "explanation": explanation,
        "recommendations": suitability["recommendations"],
        "planting_window": planting_window,
        "return_estimate": estimate,
        "ai_insight": ai_insight,
        "genai_insight": genai_insight,
    }


def get_crop_by_name(db: Session, crop_name: str) -> Crop | None:
    normalized = str(crop_name or "").strip()
    if not normalized:
        return None

    try:
        crop = db.query(Crop).filter(func.lower(Crop.name) == normalized.lower()).first()
    except SQLAlchemyError:
        db.rollback()
        crop = None

    if crop:
        return crop

    legacy_crop = get_legacy_crop_by_name(db, normalized)
    if legacy_crop:
        return legacy_crop

    return None


def get_legacy_crop_options(db: Session) -> list[dict]:
    try:
        rows = db.execute(
            text(
                """
                SELECT
                    id,
                    crop_name AS name,
                    scientific_name,
                    min_temperature,
                    max_temperature,
                    min_rainfall,
                    min_ph,
                    max_ph,
                    max_slope
                FROM crops
                WHERE crop_name IS NOT NULL
                ORDER BY lower(crop_name)
                """
            )
        ).mappings().all()
    except SQLAlchemyError:
        db.rollback()
        return []

    return [crop_to_dict(legacy_crop_row_to_threshold(row)) for row in rows]


def get_legacy_crop_by_name(db: Session, crop_name: str) -> CropThreshold | None:
    try:
        row = db.execute(
            text(
                """
                SELECT
                    id,
                    crop_name AS name,
                    scientific_name,
                    min_temperature,
                    max_temperature,
                    min_rainfall,
                    min_ph,
                    max_ph,
                    max_slope
                FROM crops
                WHERE lower(crop_name) = lower(:crop_name)
                LIMIT 1
                """
            ),
            {"crop_name": crop_name},
        ).mappings().first()
    except SQLAlchemyError:
        db.rollback()
        return None

    if not row:
        return None

    return legacy_crop_row_to_threshold(row)


def legacy_crop_row_to_threshold(row) -> CropThreshold:
    min_temperature = coerce_float(row.get("min_temperature"))
    max_temperature = coerce_float(row.get("max_temperature"))

    return CropThreshold(
        id=row.get("id"),
        name=row.get("name"),
        scientific_name=row.get("scientific_name"),
        min_temp_limit=min_temperature,
        ideal_temp_min=min_temperature,
        ideal_temp_max=max_temperature,
        max_temp_limit=max_temperature,
        min_annual_rainfall=coerce_float(row.get("min_rainfall")),
        min_soil_depth_cm=None,
        ideal_ph_min=coerce_float(row.get("min_ph")),
        ideal_ph_max=coerce_float(row.get("max_ph")),
        max_slope_pct=coerce_float(row.get("max_slope")),
    )


def crop_to_dict(crop) -> dict:
    return {
        "id": getattr(crop, "id", None),
        "name": crop.name,
        "scientific_name": crop.scientific_name,
        "min_temp_limit": coerce_float(crop.min_temp_limit),
        "ideal_temp_min": coerce_float(crop.ideal_temp_min),
        "ideal_temp_max": coerce_float(crop.ideal_temp_max),
        "max_temp_limit": coerce_float(crop.max_temp_limit),
        "min_annual_rainfall": coerce_float(crop.min_annual_rainfall),
        "min_soil_depth_cm": crop.min_soil_depth_cm,
        "ideal_ph_min": coerce_float(crop.ideal_ph_min),
        "ideal_ph_max": coerce_float(crop.ideal_ph_max),
        "max_slope_pct": coerce_float(crop.max_slope_pct),
    }


def build_fallback_crop_threshold(crop_name: str) -> CropThreshold:
    requirements = CROP_REQUIREMENTS[crop_name]
    ideal_rain_min, _ideal_rain_max, absolute_rain_min, _absolute_rain_max = requirements["rainfall"]
    ideal_temp_min, ideal_temp_max, absolute_temp_min, absolute_temp_max = requirements["temperature"]
    ideal_ph_min, ideal_ph_max, _absolute_ph_min, _absolute_ph_max = requirements["ph"]
    _ideal_slope_min, ideal_slope_max, _absolute_slope_min, absolute_slope_max = requirements["slope"]

    return CropThreshold(
        id=None,
        name=crop_name,
        scientific_name=FALLBACK_SCIENTIFIC_NAMES.get(crop_name),
        min_temp_limit=absolute_temp_min,
        ideal_temp_min=ideal_temp_min,
        ideal_temp_max=ideal_temp_max,
        max_temp_limit=absolute_temp_max,
        min_annual_rainfall=absolute_rain_min or ideal_rain_min,
        min_soil_depth_cm=60,
        ideal_ph_min=ideal_ph_min,
        ideal_ph_max=ideal_ph_max,
        max_slope_pct=slope_degrees_to_pct(absolute_slope_max or ideal_slope_max),
    )


def get_available_districts(db: Session) -> list[str]:
    try:
        rows = (
            db.execute(
                text(
                    """
                    SELECT DISTINCT district
                    FROM spatial_grids
                    WHERE district IS NOT NULL AND TRIM(district) <> ''
                    ORDER BY district
                    """
                )
            )
            .scalars()
            .all()
        )
    except SQLAlchemyError:
        db.rollback()
        return []

    return [str(row) for row in rows]


def query_environment_values(
    db: Session,
    district: str | None = None,
    polygon: list[list[float]] | None = None,
    user_inputs=None,
) -> dict:
    columns = get_spatial_grid_columns(db)
    if columns:
        spatial_environment = query_spatial_grid_environment_values(db, columns, district=district, polygon=polygon)
        if spatial_environment["sample_count"] > 0:
            values = spatial_environment["values"]
            apply_user_inputs(values, user_inputs)
            return finalize_environment_values(values, spatial_environment["sample_count"])

    raster_environment = query_raster_environment_values(db, polygon=polygon)
    values = raster_environment["values"]
    apply_user_inputs(values, user_inputs)
    return finalize_environment_values(values, raster_environment["sample_count"])


def query_spatial_grid_environment_values(
    db: Session,
    columns: set[str],
    district: str | None = None,
    polygon: list[list[float]] | None = None,
) -> dict:

    select_fragments = ["COUNT(*) AS sample_count"]
    selected_aliases: set[str] = set()

    for column_name, alias in NUMERIC_ENV_COLUMNS:
        if column_name in columns and alias not in selected_aliases:
            select_fragments.append(f"AVG({column_name}) AS {alias}")
            selected_aliases.add(alias)

    for column_name, alias in TEXT_ENV_COLUMNS:
        if column_name in columns and alias not in selected_aliases:
            select_fragments.append(f"MIN({column_name}) AS {alias}")
            selected_aliases.add(alias)

    where_clauses = ["1 = 1"]
    params: dict[str, object] = {}

    if district and "district" in columns:
        where_clauses.append("LOWER(district) = LOWER(:district)")
        params["district"] = district

    if polygon:
        where_clauses.append(build_polygon_filter(columns))
        params["polygon_wkt"] = polygon_to_wkt(polygon)

    try:
        row = (
            db.execute(
                text(
                    f"""
                    SELECT {", ".join(select_fragments)}
                    FROM spatial_grids
                    WHERE {" AND ".join(where_clauses)}
                    """
                ),
                params,
            )
            .mappings()
            .first()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise PredictionDataError("Unable to read environmental data from PostgreSQL/PostGIS.") from exc

    sample_count = int(row["sample_count"] or 0) if row else 0
    values = normalize_environment_row(row, selected_aliases, sample_count)
    return {"sample_count": sample_count, "values": values}


def query_raster_environment_values(db: Session, polygon: list[list[float]] | None = None) -> dict:
    tables = get_public_table_names(db)
    values = empty_environment_values("No matching PostGIS raster values were found.")
    counts: dict[str, int] = {}

    for field, config in RASTER_LAYERS.items():
        table = config["table"]
        if table not in tables:
            continue

        count, mean = query_raster_mean(
            db,
            table=table,
            polygon=polygon,
            zero_is_nodata=config["zero_is_nodata"],
        )
        if mean is None:
            continue

        counts[field] = count
        scaled_value = mean * config["scale"]
        values[field] = land_cover_name(scaled_value) if field == "land_cover" else scaled_value

    if values.get("dem_m") is not None:
        values["elevation_m"] = values["dem_m"]

    if "slope" in tables:
        count, mean = query_raster_mean(db, table="slope", polygon=polygon, zero_is_nodata=False)
        if mean is not None:
            counts["slope"] = count
            values["slope_deg"] = mean
            values["slope_pct"] = slope_degrees_to_pct(mean)

    if values.get("soc") is not None and values.get("organic_carbon") is None:
        values["organic_carbon"] = values["soc"]

    sample_count = max(counts.values()) if counts else 0
    if sample_count > 0:
        values["data_source"] = "agrow_db"
        values["data_source_note"] = (
            "Aggregated PostGIS raster tables from agrow_db "
            "(rainfall, temperature, soil, DEM, slope, and land cover where available)."
        )

    return {"sample_count": sample_count, "values": values}


def finalize_environment_values(values: dict, sample_count: int) -> dict:
    values["missing_fields"] = sorted(
        field
        for field in ENVIRONMENT_RESPONSE_FIELDS
        if values.get(field) is None and field not in {"slope_deg", "dem_m"}
    )

    if values.get("elevation_m") is not None and values.get("dem_m") is None:
        values["dem_m"] = values["elevation_m"]

    if values.get("slope_pct") is not None and values.get("slope_deg") is None:
        values["slope_deg"] = round(math.degrees(math.atan(values["slope_pct"] / 100.0)), 2)

    if sample_count == 0 and not values.get("data_source_note"):
        values["data_source"] = "agrow_db"
        values["data_source_note"] = "No matching PostgreSQL environmental records were found for the selected filters."

    return {"sample_count": sample_count, "values": round_environment_values(values)}


def query_raster_mean(
    db: Session,
    table: str,
    polygon: list[list[float]] | None = None,
    zero_is_nodata: bool = False,
) -> tuple[int, float | None]:
    raster_expression = "ST_SetBandNoDataValue(rast, 1, 0)" if zero_is_nodata else "rast"

    try:
        if polygon:
            row = (
                db.execute(
                    text(
                        f"""
                        WITH selected_area AS (
                            SELECT ST_SetSRID(ST_GeomFromText(:polygon_wkt), 4326) AS geom
                        ),
                        clipped_stats AS (
                            SELECT (ST_SummaryStats(
                                ST_Clip({raster_expression}, selected_area.geom, true),
                                1,
                                true
                            )).*
                            FROM {table}
                            CROSS JOIN selected_area
                            WHERE ST_Intersects(rast, selected_area.geom)
                        )
                        SELECT
                            COALESCE(SUM(count), 0)::bigint AS count,
                            SUM(sum) / NULLIF(SUM(count), 0) AS mean
                        FROM clipped_stats;
                        """
                    ),
                    {"polygon_wkt": polygon_to_wkt(polygon)},
                )
                .mappings()
                .first()
            )
        else:
            row = (
                db.execute(
                    text(
                        f"""
                        SELECT count, mean
                        FROM (
                            SELECT (ST_SummaryStatsAgg({raster_expression}, 1, true)).*
                            FROM {table}
                        ) layer_stats;
                        """
                    )
                )
                .mappings()
                .first()
            )
    except SQLAlchemyError as exc:
        db.rollback()
        raise PredictionDataError(f"Unable to read raster table '{table}' from PostgreSQL/PostGIS.") from exc

    count = int(row["count"] or 0) if row else 0
    return count, coerce_float(row["mean"]) if row else None


def get_spatial_grid_columns(db: Session) -> set[str]:
    try:
        inspector = inspect(db.bind)
        return {column["name"] for column in inspector.get_columns("spatial_grids")}
    except SQLAlchemyError:
        db.rollback()
        return set()


def get_public_table_names(db: Session) -> set[str]:
    try:
        return {
            row.table_name
            for row in db.execute(
                text(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                    """
                )
            )
        }
    except SQLAlchemyError:
        db.rollback()
        return set()


def build_polygon_filter(columns: set[str]) -> str:
    if "geom" in columns and {"longitude", "latitude"}.issubset(columns):
        geom_expression = """
            COALESCE(
                geom,
                ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
            )
        """
    elif "geom" in columns:
        geom_expression = "geom"
    elif {"longitude", "latitude"}.issubset(columns):
        geom_expression = "ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)"
    else:
        raise PredictionDataError("spatial_grids needs geom or longitude/latitude columns for polygon filtering.")

    return f"ST_Intersects({geom_expression}, ST_SetSRID(ST_GeomFromText(:polygon_wkt), 4326))"


def normalize_environment_row(row, selected_aliases: set[str], sample_count: int) -> dict:
    values = {field: None for field in ENVIRONMENT_RESPONSE_FIELDS}

    if not row:
        return empty_environment_values("No environmental records were returned.")

    for alias in selected_aliases:
        value = row.get(alias)
        values[alias] = str(value) if alias == "land_cover" and value is not None else coerce_float(value)

    values["data_source"] = "agrow_db"
    values["data_source_note"] = f"Aggregated {sample_count} spatial_grids rows from PostgreSQL."
    values["missing_fields"] = []
    values["overridden_fields"] = []
    return values


def empty_environment_values(note: str) -> dict:
    return {
        **{field: None for field in ENVIRONMENT_RESPONSE_FIELDS},
        "data_source": "agrow_db",
        "data_source_note": note,
        "missing_fields": list(ENVIRONMENT_RESPONSE_FIELDS),
        "overridden_fields": [],
    }


def apply_user_inputs(values: dict, user_inputs) -> None:
    if not user_inputs:
        return

    input_values = model_to_dict(user_inputs)
    overridden_fields = []
    for field, value in input_values.items():
        if field in ENVIRONMENT_RESPONSE_FIELDS and value is not None:
            values[field] = value
            overridden_fields.append(field)

    if overridden_fields:
        values["overridden_fields"] = sorted(overridden_fields)


def score_crop_suitability(crop: Crop, values: dict, sample_count: int) -> dict:
    parts = [
        score_minimum(
            values.get("rainfall_mm"),
            coerce_float(crop.min_annual_rainfall),
            SCORE_WEIGHTS["rainfall_mm"],
            "Rainfall meets the crop minimum stored in PostgreSQL",
            "Rainfall is below the crop minimum stored in PostgreSQL",
        ),
        score_range(
            values.get("temperature_c"),
            coerce_float(crop.ideal_temp_min),
            coerce_float(crop.ideal_temp_max),
            coerce_float(crop.min_temp_limit),
            coerce_float(crop.max_temp_limit),
            SCORE_WEIGHTS["temperature_c"],
            "Temperature sits within the crop's ideal range",
            "Temperature is outside the crop's preferred range",
        ),
        score_range(
            values.get("soil_ph"),
            coerce_float(crop.ideal_ph_min),
            coerce_float(crop.ideal_ph_max),
            max((coerce_float(crop.ideal_ph_min) or 0) - 0.8, 0),
            (coerce_float(crop.ideal_ph_max) or 14) + 0.8,
            SCORE_WEIGHTS["soil_ph"],
            "Soil pH is within the crop's ideal range",
            "Soil pH needs correction or closer field testing",
        ),
        score_minimum(
            values.get("soil_depth_cm"),
            coerce_float(crop.min_soil_depth_cm),
            SCORE_WEIGHTS["soil_depth_cm"],
            "Soil depth meets the crop's root zone requirement",
            "Soil depth is below the crop's root zone requirement",
        ),
        score_maximum(
            values.get("slope_pct"),
            coerce_float(crop.max_slope_pct),
            SCORE_WEIGHTS["slope_pct"],
            "Slope is within the crop's maximum slope threshold",
            "Slope may increase erosion, drainage, and access risk",
        ),
        score_organic_matter(values, SCORE_WEIGHTS["organic_matter"]),
    ]

    scored_parts = [part for part in parts if part["available"]]
    total_weight = sum(part["weight"] for part in scored_parts)
    weighted_score = sum(part["score"] for part in scored_parts)
    score = round((weighted_score / total_weight) * 100) if total_weight else 0

    missing_essential = [field for field in ESSENTIAL_SCORE_FIELDS if values.get(field) is None]
    if missing_essential:
        score = min(score, 86)
    if sample_count == 0:
        score = min(score, 50)

    strengths = [part["strength"] for part in scored_parts if part["rating"] == "good"]
    limitations = [part["limitation"] for part in scored_parts if part["rating"] != "good"]

    if missing_essential:
        limitations.append("Some essential environmental layers are missing from the current database match")

    recommendations = build_recommendations(crop.name, values, limitations, missing_essential)

    return {
        "score": max(0, min(100, score)),
        "status": score_to_status(score),
        "strengths": strengths or ["Database layers show usable baseline conditions for this crop"],
        "limitations": limitations or ["No major threshold conflicts were detected in the database layers"],
        "recommendations": recommendations,
        "risk_level": score_to_risk_level(score, limitations, missing_essential),
        "risk_warnings": (limitations or ["No major threshold conflicts were detected"])[:3],
        "confidence": score_confidence(sample_count, missing_essential),
    }


def score_minimum(value, minimum, weight: int, strength: str, limitation: str) -> dict:
    if value is None or minimum is None:
        return unavailable_score(weight, strength, limitation)

    if value >= minimum:
        return score_part(weight, weight, "good", strength, limitation)

    ratio = max(0.0, min(1.0, value / minimum)) if minimum else 0.0
    rating = "moderate" if ratio >= 0.7 else "poor"
    return score_part(weight * ratio, weight, rating, strength, limitation)


def score_maximum(value, maximum, weight: int, strength: str, limitation: str) -> dict:
    if value is None or maximum is None:
        return unavailable_score(weight, strength, limitation)

    if value <= maximum:
        return score_part(weight, weight, "good", strength, limitation)

    tolerance = maximum * 1.5 if maximum else maximum + 10
    if value <= tolerance:
        excess_ratio = (value - maximum) / max(tolerance - maximum, 1)
        return score_part(weight * max(0.35, 1 - excess_ratio), weight, "moderate", strength, limitation)

    return score_part(weight * 0.2, weight, "poor", strength, limitation)


def score_range(value, ideal_min, ideal_max, absolute_min, absolute_max, weight: int, strength: str, limitation: str) -> dict:
    if None in {value, ideal_min, ideal_max, absolute_min, absolute_max}:
        return unavailable_score(weight, strength, limitation)

    if ideal_min <= value <= ideal_max:
        return score_part(weight, weight, "good", strength, limitation)

    if absolute_min <= value <= absolute_max:
        if value < ideal_min:
            distance = (ideal_min - value) / max(ideal_min - absolute_min, 1)
        else:
            distance = (value - ideal_max) / max(absolute_max - ideal_max, 1)
        return score_part(weight * max(0.4, 1 - (distance * 0.65)), weight, "moderate", strength, limitation)

    return score_part(weight * 0.15, weight, "poor", strength, limitation)


def score_organic_matter(values: dict, weight: int) -> dict:
    organic_value = first_number(values.get("soc"), values.get("organic_carbon"))
    if organic_value is None:
        return unavailable_score(
            weight,
            "Soil organic matter is present in the database layers",
            "Soil organic matter is missing from the current database match",
        )

    if organic_value >= 1.5:
        return score_part(weight, weight, "good", "Soil organic matter supports nutrient cycling", "Soil organic matter is low")
    if organic_value >= 0.8:
        return score_part(weight * 0.65, weight, "moderate", "Soil organic matter supports nutrient cycling", "Soil organic matter is low")
    return score_part(weight * 0.3, weight, "poor", "Soil organic matter supports nutrient cycling", "Soil organic matter is low")


def unavailable_score(weight: int, strength: str, limitation: str) -> dict:
    return {
        "available": False,
        "score": 0.0,
        "weight": weight,
        "rating": "missing",
        "strength": strength,
        "limitation": limitation,
    }


def score_part(score: float, weight: int, rating: str, strength: str, limitation: str) -> dict:
    return {
        "available": True,
        "score": score,
        "weight": weight,
        "rating": rating,
        "strength": strength,
        "limitation": limitation,
    }


def build_recommendations(crop_name: str, values: dict, limitations: list[str], missing_essential: list[str]) -> list[str]:
    recommendations = [
        f"Validate the matched database values with a field inspection before planting {crop_name}.",
        "Use soil testing to confirm pH, nutrients, and organic carbon before fertilizer planning.",
    ]

    if values.get("soil_ph") is not None and values["soil_ph"] < 5.5:
        recommendations.append("Prepare a liming plan if field soil tests confirm acidic conditions.")
    if values.get("slope_pct") is not None and values["slope_pct"] > 10:
        recommendations.append("Use contour planting, cover crops, and drainage controls on sloped areas.")
    if values.get("rainfall_mm") is not None and values["rainfall_mm"] < 1200:
        recommendations.append("Plan irrigation or water harvesting before crop establishment.")
    if "temperature_c" in missing_essential:
        recommendations.append("Add a temperature raster or station-derived temperature layer to improve confidence.")
    if "rainfall_mm" in missing_essential:
        recommendations.append("Add rainfall data to spatial_grids before making investment decisions.")
    if limitations:
        recommendations.append("Review the limiting factors with an agronomist and adjust the crop plan.")

    return list(dict.fromkeys(recommendations))


def build_explanation(crop: Crop, district: str | None, environment: dict, suitability: dict) -> str:
    location = district or "the selected map area"
    values = environment["values"]
    sample_count = environment["sample_count"]
    source_note = values.get("data_source_note") or ""
    source = "PostGIS raster environmental layers" if "raster" in source_note.lower() else f"{sample_count} PostgreSQL spatial grid records"
    rainfall = format_value(values.get("rainfall_mm"), "mm rainfall")
    ph = format_value(values.get("soil_ph"), "soil pH")
    slope = format_value(values.get("slope_pct"), "% slope")
    limitation = suitability["limitations"][0] if suitability["limitations"] else "no major database threshold conflict was detected"

    return (
        f"{crop.name} scores {suitability['score']}/100 for {location} based on {source}. "
        f"The matched environment includes {rainfall}, {ph}, and {slope}. "
        f"The main watch point is that {limitation.lower()}."
    )


def build_planting_window(values: dict) -> dict:
    rainfall = values.get("rainfall_mm")
    if rainfall is None:
        return {
            "best_months": [],
            "reason": "Planting month guidance needs rainfall seasonality data in PostgreSQL.",
        }
    if rainfall >= 2200:
        return {
            "best_months": ["October", "November", "December", "January"],
            "reason": "High annual rainfall suggests planting should avoid the wettest establishment weeks and prioritize drainage.",
        }
    return {
        "best_months": ["March", "April", "September", "October"],
        "reason": "Moderate rainfall suggests establishment should be timed around reliable rain or backed by irrigation.",
    }


def build_return_estimate(db: Session, crop_name: str, score: int, area_hectares: float | None) -> dict:
    if not area_hectares:
        return {
            "estimated_yield_tonnes": None,
            "estimated_revenue_myr": None,
            "confidence": "Unavailable until a field boundary is provided.",
            "basis": "No area supplied in request.",
        }

    try:
        row = (
            db.query(
                func.sum(CropStatistic.production_tonnes).label("production_tonnes"),
                func.sum(CropStatistic.planted_area_ha).label("planted_area_ha"),
                func.sum(CropStatistic.economic_value_myr).label("economic_value_myr"),
            )
            .filter(func.lower(CropStatistic.crop_name) == crop_name.lower())
            .first()
        )
    except SQLAlchemyError:
        db.rollback()
        row = None

    production = coerce_float(getattr(row, "production_tonnes", None))
    planted_area = coerce_float(getattr(row, "planted_area_ha", None))
    economic_value = coerce_float(getattr(row, "economic_value_myr", None))

    if not production or not planted_area or not economic_value:
        return {
            "estimated_yield_tonnes": None,
            "estimated_revenue_myr": None,
            "confidence": "Unavailable because crop_statistics has no usable production and value rows for this crop.",
            "basis": "PostgreSQL crop_statistics aggregate.",
        }

    yield_per_ha = production / planted_area
    price_per_tonne = economic_value / production
    suitability_factor = max(0.35, min(1.05, 0.55 + (score / 200)))
    estimated_yield = area_hectares * yield_per_ha * suitability_factor

    return {
        "estimated_yield_tonnes": round(estimated_yield, 2),
        "estimated_revenue_myr": round(estimated_yield * price_per_tonne, 2),
        "confidence": "Medium - calculated from PostgreSQL crop_statistics aggregates and suitability score.",
        "basis": "PostgreSQL crop_statistics aggregate.",
    }


def calculate_polygon_area_hectares(polygon: list[list[float]] | None) -> float:
    if not polygon or len(polygon) < 3:
        return 0.0

    points = polygon[:-1] if polygon[0] == polygon[-1] else polygon
    if len(points) < 3:
        return 0.0

    mean_lat = sum(point[1] for point in points) / len(points)
    meters_per_degree_lat = 110_574.0
    meters_per_degree_lon = 111_320.0 * math.cos(math.radians(mean_lat))
    projected = [(lon * meters_per_degree_lon, lat * meters_per_degree_lat) for lon, lat in points]

    area_m2_twice = 0.0
    for index, (x1, y1) in enumerate(projected):
        x2, y2 = projected[(index + 1) % len(projected)]
        area_m2_twice += x1 * y2 - x2 * y1

    return round(abs(area_m2_twice) / 20_000.0, 2)


def polygon_to_wkt(polygon: list[list[float]]) -> str:
    coordinates = polygon[:]
    if coordinates[0] != coordinates[-1]:
        coordinates.append(coordinates[0])

    coordinate_text = ", ".join(f"{lon} {lat}" for lon, lat in coordinates)
    return f"POLYGON(({coordinate_text}))"


def score_to_status(score: int) -> str:
    if score >= 80:
        return "Highly suitable"
    if score >= 60:
        return "Suitable"
    if score >= 40:
        return "Moderately suitable"
    return "Low suitability"


def score_to_risk_level(score: int, limitations: list[str], missing_essential: list[str]) -> str:
    if score >= 80 and not missing_essential and len(limitations) <= 1:
        return "Low"
    if score >= 60:
        return "Medium"
    return "High"


def score_confidence(sample_count: int, missing_essential: list[str]) -> str:
    if sample_count == 0:
        return "Low - no matched database environmental values were found."
    if missing_essential:
        return "Medium - database rows were matched, but some essential layers are missing."
    return "High - suitability used matched PostgreSQL environment layers and crop thresholds."


def coerce_float(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def first_number(*values) -> float | None:
    for value in values:
        number = coerce_float(value)
        if number is not None:
            return number
    return None


def model_to_dict(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=True)
    return model.dict(exclude_none=True)


def round_environment_values(values: dict) -> dict:
    rounded = {}
    for key, value in values.items():
        if isinstance(value, float):
            rounded[key] = round(value, 2)
        else:
            rounded[key] = value
    return rounded


def slope_degrees_to_pct(value: float | None) -> float:
    number = coerce_float(value)
    if number is None:
        return 0.0
    return math.tan(math.radians(number)) * 100


def land_cover_name(value: float | None) -> str | None:
    number = coerce_float(value)
    if number is None:
        return None

    nearest_code = min(LAND_COVER_LABELS, key=lambda code: abs(code - number))
    return LAND_COVER_LABELS[nearest_code]


def format_value(value, suffix: str) -> str:
    if value is None:
        return f"no {suffix} value"
    return f"{round(value, 2)} {suffix}"
