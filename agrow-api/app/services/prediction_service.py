import logging
import math
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd
from sqlalchemy import func, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.crop import Crop
from app.models.crop_statistic import CropStatistic
from app.services.forest_reserve_service import validate_forest_reserve_overlap
from app.services.gemini_insight_service import (
    build_gemini_ai_insight,
    enforce_land_cover_ai_rules,
)

logger = logging.getLogger(__name__)


class PredictionNotFoundError(Exception):
    pass


class PredictionDataError(Exception):
    pass


class PredictionModelInputError(PredictionNotFoundError):
    pass


class PredictionModelError(PredictionDataError):
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
    "Cabbage": "Brassica oleracea var. capitata",
    "Durian": "Durio zibethinus",
    "Watermelon": "Citrullus lanatus",
}

CROP_REQUIREMENTS = {
    "Cabbage": {
        "rainfall": (1000, 1800, 700, 2500),
        "temperature": (15, 21, 10, 28),
        "ph": (6.0, 7.5, 5.2, 8.0),
        "slope": (0, 8, 0, 15),
        "min_soil_depth_cm": 45,
    },
    "Durian": {
        "rainfall": (1500, 3000, 1200, 3800),
        "temperature": (24, 30, 22, 35),
        "ph": (5.5, 6.5, 5.0, 7.5),
        "slope": (0, 15, 0, 25),
        "min_soil_depth_cm": 100,
    },
    "Watermelon": {
        "rainfall": (800, 1500, 500, 2200),
        "temperature": (25, 35, 18, 38),
        "ph": (6.0, 7.0, 5.2, 7.8),
        "slope": (0, 3, 0, 5),
        "min_soil_depth_cm": 50,
    },
}
SUPPORTED_PREDICTION_CROPS = tuple(CROP_REQUIREMENTS)

MODEL_ASSETS_DIR = Path(__file__).resolve().parents[1] / "ml_assets"
MODEL_PATH = MODEL_ASSETS_DIR / "crop_classifier.joblib"
ENCODER_PATH = MODEL_ASSETS_DIR / "crop_encoder.joblib"
MODEL_CLASS_ORDER = ("S1", "S2", "S3", "N")
MODEL_CLASS_LABELS = {
    "S1": "Highly suitable",
    "S2": "Suitable",
    "S3": "Moderately suitable",
    "N": "Low suitability",
}
MODEL_SCORE_BANDS = {
    "S1": (80, 100),
    "S2": (60, 79),
    "S3": (40, 59),
    "N": (0, 39),
}
MODEL_FEATURE_FIELDS = (
    "elevation_meters",
    "slope_pct",
    "soil_ph",
    "soil_depth_cm",
    "annual_rainfall_mm",
    "solar_radiation",
    "root_zone_moisture",
)
MODEL_ENVIRONMENT_PRECISION = {
    "elevation_m": 1,
    "slope_pct": 1,
    "soil_ph": 1,
    "soil_depth_cm": 0,
    "rainfall_mm": 1,
    "solar_radiation": 2,
    "root_zone_moisture": 2,
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

LAND_COVER_SOURCE_COLUMNS = (
    "land_cover",
    "land_cover_class",
    "land_cover_label",
    "landcover",
    "land_use",
)

TEXT_ENV_COLUMNS = tuple((column_name, "land_cover") for column_name in LAND_COVER_SOURCE_COLUMNS)

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

SPATIAL_GRID_POINT_COLUMNS = (
    "district",
    "elevation_meters",
    "slope_pct",
    "soil_depth_cm",
    "soil_ph",
    "annual_rainfall_mm",
    "solar_radiation",
    "root_zone_moisture",
)

SPATIAL_GRID_POINT_VALUE_MAP = {
    "elevation_meters": "elevation_m",
    "slope_pct": "slope_pct",
    "soil_depth_cm": "soil_depth_cm",
    "soil_ph": "soil_ph",
    "annual_rainfall_mm": "rainfall_mm",
    "solar_radiation": "solar_radiation",
    "root_zone_moisture": "root_zone_moisture",
}

SPATIAL_GRID_MERGE_FIELDS = tuple(SPATIAL_GRID_POINT_VALUE_MAP.values()) + ("land_cover",)

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
        crops = (
            db.query(Crop)
            .filter(func.lower(Crop.name).in_([name.lower() for name in SUPPORTED_PREDICTION_CROPS]))
            .order_by(func.lower(Crop.name))
            .all()
        )
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


def predict_suitability_with_model(crop_name: str, values: dict) -> dict:
    classifier, encoder = load_prediction_model()
    normalized_crop_name = canonical_prediction_crop_name(crop_name)
    if not normalized_crop_name:
        raise PredictionModelInputError("A supported crop is required for prediction.")

    try:
        crop_encoded = encoder.transform([normalized_crop_name])[0]
    except ValueError as exc:
        raise PredictionModelInputError(
            f"Crop target '{crop_name}' is not supported by the prediction model."
        ) from exc

    model_values = build_model_feature_values(values)
    missing_fields = [
        field_name
        for field_name in MODEL_FEATURE_FIELDS
        if model_values[field_name] is None
    ]
    if missing_fields:
        readable_fields = ", ".join(
            field_name.replace("_", " ") for field_name in missing_fields
        )
        raise PredictionModelInputError(
            f"Prediction requires values for: {readable_fields}."
        )

    input_frame = pd.DataFrame(
        [
            {
                "crop_encoded": crop_encoded,
                **model_values,
            }
        ]
    )

    try:
        prediction = str(classifier.predict(input_frame)[0])
        probabilities = classifier.predict_proba(input_frame)[0]
    except Exception as exc:
        raise PredictionModelError(
            "The crop suitability model could not complete the prediction."
        ) from exc

    raw_probabilities = {
        str(class_name): round(float(probability) * 100, 2)
        for class_name, probability in zip(
            classifier.classes_,
            probabilities,
        )
    }
    confidence_matrix = {
        class_name: raw_probabilities.get(class_name, 0.0)
        for class_name in MODEL_CLASS_ORDER
    }

    return {
        "suitability_class": prediction,
        "confidence_matrix": confidence_matrix,
        "model_confidence_pct": confidence_matrix.get(prediction, 0.0),
    }


@lru_cache(maxsize=1)
def load_prediction_model():
    if not MODEL_PATH.exists() or not ENCODER_PATH.exists():
        raise PredictionModelError(
            f"Machine learning assets are missing from {MODEL_ASSETS_DIR}."
        )

    try:
        return joblib.load(MODEL_PATH), joblib.load(ENCODER_PATH)
    except Exception as exc:
        raise PredictionModelError(
            "The crop suitability model assets could not be loaded."
        ) from exc


def build_model_feature_values(values: dict) -> dict[str, float | None]:
    raw_values = {
        "elevation_meters": first_number(
            values.get("elevation_meters"),
            values.get("elevation_m"),
            values.get("dem_m"),
        ),
        "slope_pct": first_number(values.get("slope_pct")),
        "soil_ph": first_number(values.get("soil_ph")),
        "soil_depth_cm": first_number(values.get("soil_depth_cm")),
        "annual_rainfall_mm": first_number(
            values.get("annual_rainfall_mm"),
            values.get("rainfall_mm"),
        ),
        "solar_radiation": first_number(values.get("solar_radiation")),
        "root_zone_moisture": first_number(
            values.get("root_zone_moisture")
        ),
    }

    precision_by_field = {
        "elevation_meters": 1,
        "slope_pct": 1,
        "soil_ph": 1,
        "soil_depth_cm": 0,
        "annual_rainfall_mm": 1,
        "solar_radiation": 2,
        "root_zone_moisture": 2,
    }
    return {
        field_name: (
            round_model_value(value, precision_by_field[field_name])
            if value is not None
            else None
        )
        for field_name, value in raw_values.items()
    }


def round_model_value(value: float, decimal_places: int) -> float:
    quantizer = Decimal("1").scaleb(-decimal_places)
    return float(
        Decimal(str(value)).quantize(
            quantizer,
            rounding=ROUND_HALF_UP,
        )
    )


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
        latitude=request.latitude,
        longitude=request.longitude,
        user_inputs=request.user_inputs,
    )

    if environment["sample_count"] == 0 and not request.user_inputs:
        location = f"district '{request.district}'" if request.district else "the selected area"
        raise PredictionNotFoundError(f"No environmental records were found for {location}.")

    area_hectares = calculate_polygon_area_hectares(request.polygon) if request.polygon else None
    threshold_diagnostics = score_crop_suitability(
        crop,
        environment["values"],
        environment["sample_count"],
    )
    model_prediction = predict_suitability_with_model(
        crop.name,
        environment["values"],
    )
    suitability = build_model_suitability(
        threshold_diagnostics,
        model_prediction,
        environment["sample_count"],
    )
    explanation = build_explanation(crop, request.district, environment, suitability)
    estimate = build_return_estimate(db, crop.name, suitability["score"], area_hectares)
    planting_window = build_planting_window(environment["values"])
    genai_insight, satellite_building_analysis = build_gemini_ai_insight(
        crop=crop,
        district=request.district,
        area_hectares=area_hectares,
        environment=environment,
        suitability=suitability,
        recommendations=suitability["recommendations"],
        planting_window=planting_window,
        return_estimate=estimate,
        satellite_image_data_url=(
            request.satellite_image_data_url if request.polygon else None
        ),
        fallback=explanation,
    )
    apply_satellite_land_cover_analysis(environment["values"], satellite_building_analysis)
    genai_insight = enforce_land_cover_ai_rules(
        genai_insight,
        crop=crop,
        district=request.district,
        environment=environment,
    )
    ai_insight = genai_insight.get("crop_suitability_summary") or explanation

    return {
        **forest_reserve_check,
        "crop": crop.name,
        "district": request.district,
        "area_hectares": area_hectares,
        "suitability_score": suitability["score"],
        "suitability_class": model_prediction["suitability_class"],
        "confidence_matrix": model_prediction["confidence_matrix"],
        "matched_environment": environment["values"],
        "features": environment["values"],
        "suitability": suitability,
        "explanation": explanation,
        "recommendations": suitability["recommendations"],
        "planting_window": planting_window,
        "return_estimate": estimate,
        "ai_insight": ai_insight,
        "genai_insight": genai_insight,
        "satellite_building_analysis": satellite_building_analysis,
    }


def apply_satellite_land_cover_analysis(values: dict, analysis: dict | None) -> None:
    if not analysis or analysis.get("status") != "analyzed":
        return

    if not analysis.get("land_cover_override_recommended"):
        return

    raster_land_cover = values.get("land_cover")
    if raster_land_cover and not values.get("raster_land_cover"):
        values["raster_land_cover"] = raster_land_cover

    values["land_cover"] = "built-up"
    values["land_cover_source"] = "gemini_satellite_vision"
    values["missing_fields"] = [
        field for field in values.get("missing_fields", []) if field != "land_cover"
    ]
    overridden_fields = set(values.get("overridden_fields", []))
    overridden_fields.add("land_cover")
    values["overridden_fields"] = sorted(overridden_fields)


def get_crop_by_name(db: Session, crop_name: str) -> Crop | CropThreshold | None:
    normalized = canonical_prediction_crop_name(crop_name)
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

    return build_fallback_crop_threshold(normalized)


def canonical_prediction_crop_name(crop_name: str | None) -> str | None:
    normalized = str(crop_name or "").strip().lower()
    for supported_crop in SUPPORTED_PREDICTION_CROPS:
        if supported_crop.lower() == normalized:
            return supported_crop
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

    return [
        crop_to_dict(legacy_crop_row_to_threshold(row))
        for row in rows
        if canonical_prediction_crop_name(row.get("name"))
    ]


def get_legacy_crop_by_name(db: Session, crop_name: str) -> CropThreshold | None:
    crop_name = canonical_prediction_crop_name(crop_name)
    if not crop_name:
        return None

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
        min_soil_depth_cm=requirements.get("min_soil_depth_cm", 60),
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


def get_live_ecosystem_matrix(db: Session) -> dict:
    try:
        grid_rows = (
            db.execute(
                text(
                    """
                    SELECT
                        district,
                        AVG(latitude) AS lat,
                        AVG(longitude) AS lng,
                        ROUND(AVG(elevation_meters)::numeric, 1) AS elev,
                        ROUND(AVG(slope_pct)::numeric, 1) AS slope,
                        ROUND(AVG(soil_ph)::numeric, 1) AS ph,
                        ROUND(AVG(soil_depth_cm)::numeric, 0) AS depth,
                        ROUND(AVG(annual_rainfall_mm)::numeric, 1) AS rain,
                        ROUND(AVG(solar_radiation)::numeric, 2) AS solar,
                        ROUND(AVG(root_zone_moisture)::numeric, 2) AS moisture
                    FROM spatial_grids
                    WHERE district IS NOT NULL AND TRIM(district) <> ''
                    GROUP BY district
                    ORDER BY district;
                    """
                )
            )
            .mappings()
            .all()
        )
        crop_rows = db.query(Crop.name).order_by(func.lower(Crop.name)).all()
    except SQLAlchemyError as exc:
        db.rollback()
        raise PredictionDataError("Unable to read Dashboard ecosystem matrix from PostgreSQL.") from exc

    district_matrix = {}
    for row in grid_rows:
        district = str(row.get("district") or "").strip()
        lat = coerce_float(row.get("lat"))
        lng = coerce_float(row.get("lng"))
        if not district or lat is None or lng is None:
            continue

        district_matrix[district] = {
            "lat": lat,
            "lng": lng,
            "elev": coerce_float(row.get("elev")),
            "slope": coerce_float(row.get("slope")),
            "ph": coerce_float(row.get("ph")),
            "depth": coerce_float(row.get("depth")),
            "rain": coerce_float(row.get("rain")),
            "solar": coerce_float(row.get("solar")),
            "moisture": coerce_float(row.get("moisture")),
        }

    crop_list = [
        canonical_name
        for (name,) in crop_rows
        if (canonical_name := canonical_prediction_crop_name(name))
    ] or list(SUPPORTED_PREDICTION_CROPS)

    if not district_matrix:
        return {"status": "empty", "message": "Database tables are empty. Run seed.py first."}

    return {
        "status": "success",
        "districts": district_matrix,
        "crops": crop_list,
    }


def query_environment_values(
    db: Session,
    district: str | None = None,
    polygon: list[list[float]] | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    user_inputs=None,
) -> dict:
    columns = get_spatial_grid_columns(db)
    existing_environment = query_existing_environment_values(db, columns, district=district, polygon=polygon)
    values = dict(existing_environment["values"])
    sample_count = existing_environment["sample_count"]
    value_sources = build_value_source_tracker(values)

    prediction_point = resolve_prediction_point(latitude=latitude, longitude=longitude, polygon=polygon)
    point_match_type = "not_run"

    if columns and prediction_point:
        point_environment = query_spatial_grid_point_values(
            db,
            columns,
            lat=prediction_point["lat"],
            lon=prediction_point["lon"],
        )
        point_match_type = point_environment["match_type"]
        if point_environment["sample_count"] > 0:
            merge_spatial_grid_point_values(values, point_environment["values"], value_sources)
            sample_count = max(sample_count, point_environment["sample_count"])
    elif not prediction_point:
        logger.debug("spatial_grids point lookup skipped because no prediction latitude/longitude was available.")

    overridden_fields = apply_user_inputs(values, user_inputs)
    for field in overridden_fields:
        if field in value_sources:
            value_sources[field] = "existing raster/current logic"

    finalized_environment = finalize_environment_values(values, sample_count)
    log_environment_value_sources(
        finalized_environment["values"],
        value_sources,
        prediction_point=prediction_point,
        point_match_type=point_match_type,
    )
    return finalized_environment


def query_existing_environment_values(
    db: Session,
    columns: set[str],
    district: str | None = None,
    polygon: list[list[float]] | None = None,
) -> dict:
    if columns:
        spatial_environment = query_spatial_grid_environment_values(db, columns, district=district, polygon=polygon)
        if spatial_environment["sample_count"] > 0:
            raster_environment = query_raster_environment_values(db, polygon=polygon)
            fill_missing_environment_values(spatial_environment["values"], raster_environment["values"])
            return {
                "sample_count": max(spatial_environment["sample_count"], raster_environment["sample_count"]),
                "values": spatial_environment["values"],
            }

    return query_raster_environment_values(db, polygon=polygon)


def query_spatial_grid_point_values(
    db: Session,
    columns: set[str],
    *,
    lat: float,
    lon: float,
) -> dict:
    missing_columns = set(SPATIAL_GRID_POINT_COLUMNS) - columns
    if "geom" not in columns or missing_columns:
        logger.debug(
            "spatial_grids point lookup skipped because required columns are missing: %s",
            sorted({"geom", *missing_columns} - columns),
        )
        return {"sample_count": 0, "values": {}, "match_type": "missing_columns"}

    select_fragments = list(SPATIAL_GRID_POINT_COLUMNS)
    land_cover_column = get_land_cover_source_column(columns)
    if land_cover_column:
        select_fragments.append(f"{land_cover_column} AS land_cover")
    select_columns = ", ".join(select_fragments)

    try:
        row = (
            db.execute(
                text(
                    f"""
                    SELECT
                      {select_columns}
                    FROM spatial_grids
                    WHERE ST_Intersects(
                      geom,
                      ST_SetSRID(ST_Point(:lon, :lat), 4326)
                    )
                    LIMIT 1
                    """
                ),
                {"lat": lat, "lon": lon},
            )
            .mappings()
            .first()
        )
        match_type = "intersects"

        if not row:
            row = (
                db.execute(
                    text(
                        f"""
                        SELECT
                          {select_columns}
                        FROM spatial_grids
                        ORDER BY geom <-> ST_SetSRID(ST_Point(:lon, :lat), 4326)
                        LIMIT 1
                        """
                    ),
                    {"lat": lat, "lon": lon},
                )
                .mappings()
                .first()
            )
            match_type = "nearest"
    except SQLAlchemyError as exc:
        db.rollback()
        raise PredictionDataError("Unable to read point environmental data from spatial_grids.") from exc

    if not row:
        return {"sample_count": 0, "values": {}, "match_type": "no_match"}

    logger.debug(
        "spatial_grids point lookup used %s match for lon=%s lat=%s.",
        match_type,
        lon,
        lat,
    )
    row_data = dict(row)
    return {
        "sample_count": 1,
        "values": normalize_spatial_grid_point_row(row_data),
        "district": row_data.get("district"),
        "match_type": match_type,
    }


def normalize_spatial_grid_point_row(row) -> dict:
    values = {
        field: coerce_float(row.get(column_name))
        for column_name, field in SPATIAL_GRID_POINT_VALUE_MAP.items()
    }

    if row.get("land_cover") is not None:
        values["land_cover"] = str(row.get("land_cover"))

    return values


def get_land_cover_source_column(columns: set[str]) -> str | None:
    for column_name in LAND_COVER_SOURCE_COLUMNS:
        if column_name in columns:
            return column_name
    return None


def merge_spatial_grid_point_values(values: dict, spatial_values: dict, value_sources: dict[str, str]) -> None:
    for field in SPATIAL_GRID_MERGE_FIELDS:
        if spatial_values.get(field) is None:
            value_sources[field] = (
                "existing raster/current logic" if values.get(field) is not None else "fallback/default"
            )
            continue

        values[field] = spatial_values[field]
        value_sources[field] = "spatial_grids"

        if field == "elevation_m":
            values["dem_m"] = spatial_values[field]
        elif field == "slope_pct":
            values["slope_deg"] = None


def fill_missing_environment_values(values: dict, fallback_values: dict) -> None:
    filled_fields = []
    for field in ENVIRONMENT_RESPONSE_FIELDS:
        if values.get(field) is None and fallback_values.get(field) is not None:
            values[field] = fallback_values[field]
            filled_fields.append(field)

    if filled_fields:
        note = values.get("data_source_note") or ""
        values["data_source_note"] = (
            f"{note} Missing fields filled from existing raster/current logic: {', '.join(sorted(filled_fields))}."
        ).strip()


def build_value_source_tracker(values: dict) -> dict[str, str]:
    return {
        field: "existing raster/current logic" if values.get(field) is not None else "fallback/default"
        for field in SPATIAL_GRID_MERGE_FIELDS
    }


def log_environment_value_sources(
    values: dict,
    value_sources: dict[str, str],
    *,
    prediction_point: dict | None,
    point_match_type: str,
) -> None:
    point_source = prediction_point["source"] if prediction_point else "none"
    for field in SPATIAL_GRID_MERGE_FIELDS:
        logger.debug(
            "Prediction environment value %s=%s came from %s (point_source=%s, spatial_lookup=%s).",
            field,
            values.get(field),
            value_sources.get(field, "fallback/default"),
            point_source,
            point_match_type,
        )


def resolve_prediction_point(
    *,
    latitude: float | None = None,
    longitude: float | None = None,
    polygon: list[list[float]] | None = None,
) -> dict | None:
    lat = coerce_float(latitude)
    lon = coerce_float(longitude)
    if is_valid_lon_lat(lon, lat):
        return {"lat": lat, "lon": lon, "source": "request"}

    return polygon_centroid_point(polygon)


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
            decimal_places = MODEL_ENVIRONMENT_PRECISION.get(alias)
            aggregate = f"AVG({column_name})"
            if decimal_places is not None:
                aggregate = (
                    f"ROUND(AVG({column_name})::numeric, "
                    f"{decimal_places})"
                )
            select_fragments.append(f"{aggregate} AS {alias}")
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
    values = empty_environment_values("No matching map layer values were found.")
    counts: dict[str, int] = {}

    for field, config in RASTER_LAYERS.items():
        table = config["table"]
        if table not in tables:
            continue

        if field == "land_cover":
            count, raw_value = query_raster_mode(db, table=table, polygon=polygon)
        else:
            count, raw_value = query_raster_mean(
                db,
                table=table,
                polygon=polygon,
                zero_is_nodata=config["zero_is_nodata"],
            )

        if raw_value is None:
            continue

        counts[field] = count
        scaled_value = raw_value * config["scale"]
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
            "Combined local map layers for rainfall, temperature, soil, elevation, slope, and land cover where available."
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
        values["data_source_note"] = "No matching environmental records were found for the selected filters."

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


def query_raster_mode(
    db: Session,
    table: str,
    polygon: list[list[float]] | None = None,
) -> tuple[int, float | None]:
    """Return the most frequent non-NoData pixel value for a categorical raster."""
    try:
        if polygon:
            row = (
                db.execute(
                    text(
                        f"""
                        WITH selected_area AS (
                            SELECT ST_SetSRID(ST_GeomFromText(:polygon_wkt), 4326) AS geom
                        ),
                        pixel_counts AS (
                            SELECT
                                (value_count).value AS value,
                                (value_count).count AS count
                            FROM {table}
                            CROSS JOIN selected_area
                            CROSS JOIN LATERAL ST_ValueCount(
                                ST_Clip(
                                    ST_SetBandNoDataValue(rast, 1, 0),
                                    selected_area.geom,
                                    true,
                                    true
                                ),
                                1,
                                true
                            ) AS value_count
                            WHERE ST_Intersects(rast, selected_area.geom)
                        ),
                        class_counts AS (
                            SELECT value, SUM(count)::bigint AS count
                            FROM pixel_counts
                            WHERE value <> 0
                            GROUP BY value
                        )
                        SELECT
                            COALESCE(SUM(count), 0)::bigint AS count,
                            (
                                SELECT value
                                FROM class_counts
                                ORDER BY count DESC, value ASC
                                LIMIT 1
                            ) AS mode
                        FROM class_counts;
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
                        WITH pixel_counts AS (
                            SELECT (value_count).value AS value, (value_count).count AS count
                            FROM {table}
                            CROSS JOIN LATERAL ST_ValueCount(
                                ST_SetBandNoDataValue(rast, 1, 0),
                                1,
                                true
                            ) AS value_count
                        ),
                        class_counts AS (
                            SELECT value, SUM(count)::bigint AS count
                            FROM pixel_counts
                            WHERE value <> 0
                            GROUP BY value
                        )
                        SELECT
                            COALESCE(SUM(count), 0)::bigint AS count,
                            (
                                SELECT value
                                FROM class_counts
                                ORDER BY count DESC, value ASC
                                LIMIT 1
                            ) AS mode
                        FROM class_counts;
                        """
                    )
                )
                .mappings()
                .first()
            )
    except SQLAlchemyError as exc:
        db.rollback()
        raise PredictionDataError(f"Unable to read categorical raster table '{table}'.") from exc

    count = int(row["count"] or 0) if row else 0
    return count, coerce_float(row["mode"]) if row else None


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
    values["data_source_note"] = f"Combined {sample_count} local environmental grid rows."
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


def apply_user_inputs(values: dict, user_inputs) -> list[str]:
    if not user_inputs:
        return []

    input_values = model_to_dict(user_inputs)
    overridden_fields = []
    for field, value in input_values.items():
        if field in ENVIRONMENT_RESPONSE_FIELDS and value is not None:
            values[field] = value
            overridden_fields.append(field)

    if overridden_fields:
        values["overridden_fields"] = sorted(overridden_fields)

    return overridden_fields


def build_model_suitability(
    threshold_diagnostics: dict,
    model_prediction: dict,
    sample_count: int,
) -> dict:
    suitability_class = model_prediction["suitability_class"]
    confidence_matrix = model_prediction["confidence_matrix"]
    model_confidence = float(
        model_prediction.get("model_confidence_pct", 0.0)
    )
    score = model_class_to_score(suitability_class, model_confidence)
    limitations = list(threshold_diagnostics.get("limitations", []))

    if model_confidence >= 70:
        confidence_level = "High"
    elif model_confidence >= 45:
        confidence_level = "Medium"
    else:
        confidence_level = "Low"

    data_note = (
        "matched environmental records"
        if sample_count > 0
        else "the supplied environmental values"
    )

    return {
        **threshold_diagnostics,
        "score": score,
        "status": MODEL_CLASS_LABELS.get(
            suitability_class,
            suitability_class,
        ),
        "risk_level": score_to_risk_level(score, limitations, []),
        "confidence": (
            f"{confidence_level} model confidence "
            f"({model_confidence:.2f}%) using {data_note}."
        ),
        "classification": suitability_class,
        "confidence_matrix": confidence_matrix,
        "model_confidence_pct": model_confidence,
    }


def model_class_to_score(
    suitability_class: str,
    confidence_pct: float,
) -> int:
    lower_score, upper_score = MODEL_SCORE_BANDS.get(
        suitability_class,
        (0, 100),
    )
    confidence_ratio = max(0.0, min(100.0, confidence_pct)) / 100

    if suitability_class == "N":
        return round(upper_score * (1 - confidence_ratio))

    return round(
        lower_score + ((upper_score - lower_score) * confidence_ratio)
    )


def score_crop_suitability(crop: Crop, values: dict, sample_count: int) -> dict:
    parts = [
        score_minimum(
            values.get("rainfall_mm"),
            coerce_float(crop.min_annual_rainfall),
            SCORE_WEIGHTS["rainfall_mm"],
            "Rainfall meets the crop minimum for this crop",
            "Rainfall is below the crop minimum for this crop",
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
        limitations.append("Some essential environmental layers are missing from the current data match")

    recommendations = build_recommendations(crop.name, values, limitations, missing_essential)

    return {
        "score": max(0, min(100, score)),
        "status": score_to_status(score),
        "strengths": strengths or ["Local data layers show usable baseline conditions for this crop"],
        "limitations": limitations or ["No major threshold conflicts were detected in the available data layers"],
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
            "Soil organic matter is present in the available data layers",
            "Soil organic matter is missing from the current data match",
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
        f"Validate the matched environmental values with a field inspection before planting {crop_name}.",
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
        recommendations.append("Add local rainfall data before making investment decisions.")
    if limitations:
        recommendations.append("Review the limiting factors with an agronomist and adjust the crop plan.")

    return list(dict.fromkeys(recommendations))


def build_explanation(crop: Crop, district: str | None, environment: dict, suitability: dict) -> str:
    location = district or "the selected map area"
    values = environment["values"]
    sample_count = environment["sample_count"]
    source_note = values.get("data_source_note") or ""
    source = "local environmental map layers" if "map layer" in source_note.lower() else "local environmental grid data"
    rainfall = format_value(values.get("rainfall_mm"), "mm rainfall")
    ph = format_value(values.get("soil_ph"), "soil pH")
    slope = format_value(values.get("slope_pct"), "% slope")
    limitation = suitability["limitations"][0] if suitability["limitations"] else "no major crop threshold conflict was detected"

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
            "reason": "Planting month guidance needs local rainfall seasonality data.",
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
            "basis": "The return estimate needs a selected farm area before yield and revenue can be calculated.",
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
            "confidence": "Return estimate is unavailable because there is not enough local crop production and value data for this crop.",
            "basis": "Based on available crop and environmental data.",
        }

    yield_per_ha = production / planted_area
    price_per_tonne = economic_value / production
    suitability_factor = max(0.35, min(1.05, 0.55 + (score / 200)))
    estimated_yield = area_hectares * yield_per_ha * suitability_factor

    return {
        "estimated_yield_tonnes": round(estimated_yield, 2),
        "estimated_revenue_myr": round(estimated_yield * price_per_tonne, 2),
        "confidence": "Medium confidence estimate based on available crop statistics and the calculated suitability score.",
        "basis": (
            "The return estimate is based on historical crop production data, estimated yield, market value, "
            "and the suitability score for this location."
        ),
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


def polygon_centroid_point(polygon: list[list[float]] | None) -> dict | None:
    if not polygon:
        return None

    points = []
    for point in polygon:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue

        lon = coerce_float(point[0])
        lat = coerce_float(point[1])
        if is_valid_lon_lat(lon, lat):
            points.append((lon, lat))

    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]

    if not points:
        return None

    if len(points) < 3:
        lon = sum(point[0] for point in points) / len(points)
        lat = sum(point[1] for point in points) / len(points)
        return {"lat": lat, "lon": lon, "source": "polygon_centroid"}

    signed_area = 0.0
    centroid_x = 0.0
    centroid_y = 0.0

    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        cross = (x1 * y2) - (x2 * y1)
        signed_area += cross
        centroid_x += (x1 + x2) * cross
        centroid_y += (y1 + y2) * cross

    signed_area *= 0.5
    if abs(signed_area) < 1e-12:
        lon = sum(point[0] for point in points) / len(points)
        lat = sum(point[1] for point in points) / len(points)
    else:
        lon = centroid_x / (6.0 * signed_area)
        lat = centroid_y / (6.0 * signed_area)

    if not is_valid_lon_lat(lon, lat):
        return None

    return {"lat": lat, "lon": lon, "source": "polygon_centroid"}


def is_valid_lon_lat(lon, lat) -> bool:
    return lon is not None and lat is not None and -180 <= lon <= 180 and -90 <= lat <= 90


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
        return "Low confidence because no matched environmental values were found."
    if missing_essential:
        return "Medium confidence because some essential environmental layers are missing."
    return "High confidence because matched environmental values and crop thresholds were available."


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
