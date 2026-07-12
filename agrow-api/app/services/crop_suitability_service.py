import math
from decimal import Decimal

from sqlalchemy import func, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.crop_statistic import CropStatistic


SUPPORTED_CROPS = ("Banana", "Cocoa", "Corn", "Rice", "Durian", "Pineapple", "Oil Palm")

REFERENCE_FEATURES = {
    "rainfall_mm": 2700.0,
    "temperature_c": 27.0,
    "soil_ph": 5.8,
    "nitrogen": 0.21,
    "organic_carbon": 1.8,
    "elevation_m": 120.0,
    "slope_deg": 4.0,
    "land_cover": "cropland",
}

CROP_REQUIREMENTS = {
    "Banana": {
        "rainfall": (1800, 2800, 1200, 3500),
        "temperature": (26, 30, 20, 35),
        "ph": (5.5, 7.0, 4.8, 7.8),
        "elevation": (0, 500, 0, 1200),
        "slope": (0, 8, 0, 18),
        "yield_tonnes_per_ha": 20.0,
        "price_myr_per_tonne": 1200.0,
        "best_months": ["October", "November", "December", "January"],
    },
    "Cocoa": {
        "rainfall": (1500, 2500, 1200, 3200),
        "temperature": (24, 30, 18, 34),
        "ph": (5.0, 6.8, 4.5, 7.5),
        "elevation": (0, 450, 0, 800),
        "slope": (0, 12, 0, 25),
        "yield_tonnes_per_ha": 0.8,
        "price_myr_per_tonne": 8000.0,
        "best_months": ["October", "November", "December", "January"],
    },
    "Corn": {
        "rainfall": (500, 1200, 350, 1800),
        "temperature": (21, 30, 18, 35),
        "ph": (5.8, 7.0, 5.0, 8.0),
        "elevation": (0, 700, 0, 1500),
        "slope": (0, 8, 0, 18),
        "yield_tonnes_per_ha": 5.0,
        "price_myr_per_tonne": 900.0,
        "best_months": ["March", "April", "September", "October"],
    },
    "Rice": {
        "rainfall": (1200, 2400, 900, 3200),
        "temperature": (24, 32, 20, 36),
        "ph": (5.5, 7.0, 4.8, 8.0),
        "elevation": (0, 300, 0, 700),
        "slope": (0, 3, 0, 8),
        "yield_tonnes_per_ha": 4.0,
        "price_myr_per_tonne": 1300.0,
        "best_months": ["October", "November", "December"],
    },
    "Durian": {
        "rainfall": (1500, 3000, 1200, 3800),
        "temperature": (24, 30, 20, 35),
        "ph": (5.5, 6.5, 5.0, 7.5),
        "elevation": (50, 600, 0, 1000),
        "slope": (0, 15, 0, 25),
        "yield_tonnes_per_ha": 8.0,
        "price_myr_per_tonne": 12000.0,
        "best_months": ["September", "October", "November", "December"],
    },
    "Pineapple": {
        "rainfall": (1000, 2000, 800, 2800),
        "temperature": (22, 30, 18, 35),
        "ph": (4.5, 6.5, 4.0, 7.2),
        "elevation": (0, 500, 0, 1000),
        "slope": (0, 10, 0, 20),
        "yield_tonnes_per_ha": 45.0,
        "price_myr_per_tonne": 900.0,
        "best_months": ["March", "April", "October", "November"],
    },
    "Oil Palm": {
        "rainfall": (2000, 3000, 1500, 3800),
        "temperature": (24, 32, 20, 36),
        "ph": (4.5, 6.5, 4.0, 7.5),
        "elevation": (0, 300, 0, 700),
        "slope": (0, 8, 0, 18),
        "yield_tonnes_per_ha": 20.0,
        "price_myr_per_tonne": 700.0,
        "best_months": ["October", "November", "December", "January"],
    },
}

SCORE_WEIGHTS = {
    "rainfall": 22,
    "temperature": 18,
    "soil_ph": 20,
    "elevation": 14,
    "slope": 16,
    "land_cover": 10,
}


def canonical_crop_name(crop: str) -> str | None:
    normalized = str(crop or "").strip().lower()
    for supported_crop in SUPPORTED_CROPS:
        if supported_crop.lower() == normalized:
            return supported_crop
    return None


def analyze_crop_area(db: Session, crop: str, polygon: list[list[float]]) -> dict:
    area_hectares = calculate_polygon_area_hectares(polygon)
    features = extract_environmental_features(db, polygon)
    suitability = score_suitability(crop, features)
    planting_window = build_planting_window(crop, features)
    return_estimate = build_return_estimate(db, crop, area_hectares, suitability["score"])
    ai_insight = build_ai_insight(crop, features, suitability)

    return {
        "crop": crop,
        "area_hectares": area_hectares,
        "features": features,
        "suitability": suitability,
        "planting_window": planting_window,
        "return_estimate": return_estimate,
        "ai_insight": ai_insight,
    }


def calculate_polygon_area_hectares(polygon: list[list[float]]) -> float:
    points = polygon[:-1] if polygon and polygon[0] == polygon[-1] else polygon
    if len(points) < 3:
        return 0.0

    mean_lat = sum(point[1] for point in points) / len(points)
    meters_per_degree_lat = 110_574.0
    meters_per_degree_lon = 111_320.0 * math.cos(math.radians(mean_lat))
    projected = [
        (lon * meters_per_degree_lon, lat * meters_per_degree_lat)
        for lon, lat in points
    ]

    area_m2 = 0.0
    for index, (x1, y1) in enumerate(projected):
        x2, y2 = projected[(index + 1) % len(projected)]
        area_m2 += x1 * y2 - x2 * y1

    return round(abs(area_m2) / 20_000.0, 2)


def extract_environmental_features(db: Session, polygon: list[list[float]]) -> dict:
    placeholder_fields = ["temperature_c", "nitrogen", "organic_carbon", "land_cover"]
    fallback = build_placeholder_features(
        "Spatial grid data could not be extracted from agrow_db for this polygon."
    )

    try:
        result = db.execute(
            text(
                """
                WITH selected_area AS (
                    SELECT ST_SetSRID(ST_GeomFromText(:polygon_wkt), 4326) AS geom
                ),
                matched_cells AS (
                    SELECT
                        s.annual_rainfall_mm,
                        s.soil_ph,
                        s.elevation_meters,
                        s.slope_pct,
                        s.solar_radiation,
                        s.root_zone_moisture
                    FROM spatial_grids s
                    CROSS JOIN selected_area a
                    WHERE ST_Intersects(
                        COALESCE(
                            s.geom,
                            ST_SetSRID(
                                ST_MakePoint(
                                    s.longitude::double precision,
                                    s.latitude::double precision
                                ),
                                4326
                            )
                        ),
                        a.geom
                    )
                )
                SELECT
                    COUNT(*) AS sample_count,
                    AVG(annual_rainfall_mm) AS rainfall_mm,
                    AVG(soil_ph) AS soil_ph,
                    AVG(elevation_meters) AS elevation_m,
                    AVG(slope_pct) AS slope_pct,
                    AVG(solar_radiation) AS solar_radiation,
                    AVG(root_zone_moisture) AS root_zone_moisture
                FROM matched_cells;
                """
            ),
            {"polygon_wkt": polygon_to_wkt(polygon)},
        ).mappings().first()
    except SQLAlchemyError:
        db.rollback()
        return fallback

    if not result or int(result["sample_count"] or 0) == 0:
        return build_placeholder_features(
            "No spatial grid cells intersected the selected polygon."
        )

    rainfall = coerce_float(result["rainfall_mm"])
    soil_ph = coerce_float(result["soil_ph"])
    elevation = coerce_float(result["elevation_m"])
    slope_pct = coerce_float(result["slope_pct"])
    solar_radiation = coerce_float(result["solar_radiation"])
    root_zone_moisture = coerce_float(result["root_zone_moisture"])

    features = {
        **REFERENCE_FEATURES,
        "rainfall_mm": value_or_reference(rainfall, "rainfall_mm", placeholder_fields),
        "soil_ph": value_or_reference(soil_ph, "soil_ph", placeholder_fields),
        "elevation_m": value_or_reference(elevation, "elevation_m", placeholder_fields),
        "slope_deg": round(math.degrees(math.atan((slope_pct or 0.0) / 100.0)), 2)
        if slope_pct is not None
        else value_or_reference(None, "slope_deg", placeholder_fields),
        "solar_radiation": round(solar_radiation, 2) if solar_radiation is not None else None,
        "root_zone_moisture": round(root_zone_moisture, 3) if root_zone_moisture is not None else None,
        "sample_count": int(result["sample_count"] or 0),
        "data_source": "agrow_db",
        "placeholder_fields": sorted(set(placeholder_fields)),
        "data_source_note": (
            "Aggregated intersecting spatial_grids rows from agrow_db. "
            "Fields listed in placeholder_fields are not present in the current SpatialGrid model."
        ),
    }

    return round_numeric_features(features)


def build_placeholder_features(reason: str) -> dict:
    return {
        **REFERENCE_FEATURES,
        "data_source": "placeholder",
        "placeholder_fields": sorted(REFERENCE_FEATURES.keys()),
        "sample_count": 0,
        "data_source_note": reason,
    }


def polygon_to_wkt(polygon: list[list[float]]) -> str:
    coordinates = polygon[:]
    if coordinates[0] != coordinates[-1]:
        coordinates.append(coordinates[0])

    coordinate_text = ", ".join(f"{lon} {lat}" for lon, lat in coordinates)
    return f"POLYGON(({coordinate_text}))"


def value_or_reference(value: float | None, key: str, placeholder_fields: list[str]) -> float:
    if value is None:
        placeholder_fields.append(key)
        return REFERENCE_FEATURES[key]
    return value


def score_suitability(crop: str, features: dict) -> dict:
    requirements = CROP_REQUIREMENTS[crop]
    score_parts = [
        score_range(
            features["rainfall_mm"],
            requirements["rainfall"],
            SCORE_WEIGHTS["rainfall"],
            "Rainfall is suitable",
            "Rainfall may need water management",
        ),
        score_range(
            features["temperature_c"],
            requirements["temperature"],
            SCORE_WEIGHTS["temperature"],
            "Temperature is suitable",
            "Temperature is outside the preferred range",
        ),
        score_range(
            features["soil_ph"],
            requirements["ph"],
            SCORE_WEIGHTS["soil_ph"],
            "Soil pH is suitable",
            "Soil pH should be monitored",
        ),
        score_range(
            features["elevation_m"],
            requirements["elevation"],
            SCORE_WEIGHTS["elevation"],
            "Elevation is suitable",
            "Elevation may constrain crop performance",
        ),
        score_range(
            features["slope_deg"],
            requirements["slope"],
            SCORE_WEIGHTS["slope"],
            "Slope is manageable",
            "Slope may increase erosion and access risk",
        ),
        score_land_cover(features["land_cover"], SCORE_WEIGHTS["land_cover"]),
    ]

    score = round(sum(part["score"] for part in score_parts))
    if features.get("data_source") == "placeholder":
        score = min(score, 55)
    elif {"temperature_c", "land_cover"}.intersection(features.get("placeholder_fields", [])):
        score = min(score, 82)
    strengths = [part["strength"] for part in score_parts if part["rating"] == "good"]
    limitations = [part["limitation"] for part in score_parts if part["rating"] != "good"]

    if features.get("placeholder_fields"):
        limitations.append(
            "Some environmental fields are placeholders because they are not available in the current GIS tables"
        )

    recommendations = build_recommendations(crop, limitations, features)

    # TODO: Replace rule-based scoring with trained ML model once labelled crop
    # yield/statistics data is available. Suggested future model path:
    # app/ml_assets/crop_yield_model.joblib
    return {
        "score": max(0, min(100, score)),
        "status": score_to_status(score),
        "strengths": strengths or ["The selected polygon has usable baseline growing conditions"],
        "limitations": limitations or ["No major rule-based constraints detected"],
        "recommendations": recommendations,
        "risk_level": score_to_risk_level(score, limitations),
        "risk_warnings": limitations[:3],
    }


def score_range(
    value: float,
    ranges: tuple[float, float, float, float],
    weight: int,
    strength: str,
    limitation: str,
) -> dict:
    ideal_min, ideal_max, absolute_min, absolute_max = ranges
    if ideal_min <= value <= ideal_max:
        return {"score": weight, "rating": "good", "strength": strength, "limitation": limitation}

    if absolute_min <= value <= absolute_max:
        if value < ideal_min:
            distance = (ideal_min - value) / max(ideal_min - absolute_min, 1)
        else:
            distance = (value - ideal_max) / max(absolute_max - ideal_max, 1)
        return {
            "score": weight * max(0.45, 1 - (distance * 0.55)),
            "rating": "moderate",
            "strength": strength,
            "limitation": limitation,
        }

    return {"score": weight * 0.2, "rating": "poor", "strength": strength, "limitation": limitation}


def score_land_cover(land_cover: str, weight: int) -> dict:
    normalized = str(land_cover or "").lower()
    if normalized in {"cropland", "grassland", "shrubland"}:
        return {
            "score": weight,
            "rating": "good",
            "strength": "Land cover is compatible with farm planning",
            "limitation": "Land cover may need field verification",
        }
    if normalized in {"forest", "wetland"}:
        return {
            "score": weight * 0.45,
            "rating": "moderate",
            "strength": "Land cover is compatible with farm planning",
            "limitation": "Land cover may require permitting or conservation review",
        }
    return {
        "score": weight * 0.25,
        "rating": "poor",
        "strength": "Land cover is compatible with farm planning",
        "limitation": "Land cover is not clearly suitable for crop establishment",
    }


def build_recommendations(crop: str, limitations: list[str], features: dict) -> list[str]:
    recommendations = ["Test soil before planting", "Maintain drainage", "Apply organic matter where needed"]

    if features["slope_deg"] > 8:
        recommendations.append("Use contour planting and erosion control on sloped sections")
    if features["rainfall_mm"] > CROP_REQUIREMENTS[crop]["rainfall"][1]:
        recommendations.append("Plan drainage before peak rainfall")
    if "placeholder_fields" in features and features["placeholder_fields"]:
        recommendations.append("Replace placeholder layers with field or raster measurements when available")
    if limitations:
        recommendations.append("Validate constraints with an agronomist before major investment")

    return list(dict.fromkeys(recommendations))


def score_to_status(score: int) -> str:
    if score >= 80:
        return "Highly suitable"
    if score >= 60:
        return "Suitable"
    if score >= 40:
        return "Moderately suitable"
    return "Low suitability"


def score_to_risk_level(score: int, limitations: list[str]) -> str:
    if score >= 80 and len(limitations) <= 1:
        return "Low"
    if score >= 60:
        return "Medium"
    return "High"


def build_planting_window(crop: str, features: dict) -> dict:
    months = CROP_REQUIREMENTS[crop]["best_months"]
    rainfall = features["rainfall_mm"]

    if rainfall > CROP_REQUIREMENTS[crop]["rainfall"][1]:
        reason = "These months usually support establishment, but drainage should be prepared before heavy rainfall."
    elif rainfall < CROP_REQUIREMENTS[crop]["rainfall"][0]:
        reason = "These months usually offer better rainfall for establishment in Sabah, with irrigation backup if needed."
    else:
        reason = "These months usually provide better rainfall for crop establishment in Sabah."

    return {"best_months": months, "reason": reason}


def build_return_estimate(db: Session, crop: str, area_hectares: float, score: int) -> dict:
    yield_per_ha, price_per_tonne, basis = get_reference_return_values(db, crop)
    suitability_factor = max(0.35, min(1.05, 0.55 + (score / 200)))
    estimated_yield = area_hectares * yield_per_ha * suitability_factor
    estimated_revenue = estimated_yield * price_per_tonne

    return {
        "area_hectares": area_hectares,
        "estimated_yield_tonnes": round(estimated_yield, 2),
        "estimated_revenue_myr": round(estimated_revenue),
        "confidence": "Low - based on reference assumptions, not trained local crop statistics",
        "basis": basis,
    }


def get_reference_return_values(db: Session, crop: str) -> tuple[float, float, str]:
    defaults = CROP_REQUIREMENTS[crop]

    try:
        row = (
            db.query(
                func.sum(CropStatistic.production_tonnes).label("production_tonnes"),
                func.sum(CropStatistic.planted_area_ha).label("planted_area_ha"),
                func.sum(CropStatistic.economic_value_myr).label("economic_value_myr"),
            )
            .filter(func.lower(CropStatistic.crop_name) == crop.lower())
            .first()
        )
    except SQLAlchemyError:
        db.rollback()
        row = None

    if row and row.production_tonnes and row.planted_area_ha:
        production = coerce_float(row.production_tonnes) or 0.0
        planted_area = coerce_float(row.planted_area_ha) or 0.0
        economic_value = coerce_float(row.economic_value_myr) or 0.0
        if production > 0 and planted_area > 0 and economic_value > 0:
            return (
                production / planted_area,
                economic_value / production,
                "agrow_db crop_statistics aggregate, still low confidence until labelled farm-level data exists",
            )

    return (
        defaults["yield_tonnes_per_ha"],
        defaults["price_myr_per_tonne"],
        "reference crop assumptions",
    )


def build_ai_insight(crop: str, features: dict, suitability: dict) -> str:
    strengths = ", ".join(suitability["strengths"][:2]).lower()
    limitation = suitability["limitations"][0] if suitability["limitations"] else "field checks are still recommended"
    source_phrase = (
        "from agrow_db spatial grid samples"
        if features.get("data_source") == "agrow_db"
        else "from placeholder environmental values"
    )

    return (
        f"This selected area appears {suitability['status'].lower()} for {crop} based on {source_phrase}. "
        f"The main positives are {strengths}. However, {limitation.lower()}."
    )


def coerce_float(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def round_numeric_features(features: dict) -> dict:
    rounded = {}
    for key, value in features.items():
        if isinstance(value, float):
            rounded[key] = round(value, 2)
        else:
            rounded[key] = value
    return rounded
