import json
import logging
import os
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

try:
    from dotenv import dotenv_values, load_dotenv
except ModuleNotFoundError:
    dotenv_values = None
    load_dotenv = None


BACKEND_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
if load_dotenv is not None:
    load_dotenv(BACKEND_ENV_PATH)

logger = logging.getLogger(__name__)

DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite"
GEMINI_ENDPOINT_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MISSING_DATA_MESSAGE = "No major missing data was flagged in the current analysis."
LAND_COVER_PAYLOAD_FIELDS = (
    "land_cover",
    "land_cover_class",
    "land_cover_label",
    "landcover",
    "land_use",
)
UNKNOWN_LAND_COVER_VALUES = {
    "unknown",
    "unavailable",
    "not available",
    "n/a",
    "na",
    "none",
    "null",
    "no data",
    "nodata",
}
LAND_COVER_MISSING_MESSAGE = "Land cover is missing or unknown."
IGNORED_MISSING_DATA_FIELDS = {
    "nitrogen",
    "nitrogen_pct",
    "bdod",
    "bulk_density",
    "silt",
    "silt_pct",
    "sand",
    "sand_pct",
    "clay",
    "clay_pct",
    "cec",
    "cation_exchange_capacity",
    "soc",
    "soil_organic_carbon",
    "organic_carbon",
    "organic_carbon_pct",
}
IGNORED_MISSING_DATA_TERMS = (
    "nitrogen",
    "bdod",
    "bulk density",
    "silt",
    "sand",
    "clay",
    "cec",
    "cation exchange capacity",
    "soc",
    "soil organic carbon",
    "organic carbon",
)


class PredictionInsightOutput(BaseModel):
    crop_suitability_summary: str = Field(
        description="One farmer-friendly sentence summarizing crop suitability."
    )
    key_strengths: list[str] = Field(
        description="Two to four short strengths from the supplied analysis data."
    )
    potential_risks: list[str] = Field(
        description="Two to four short risks or limitations from the supplied analysis data."
    )
    recommended_actions: list[str] = Field(
        description="Two to four short farmer-friendly next actions."
    )
    best_planting_months: list[str] = Field(
        description="Two to four full English month names recommended for planting in Sabah."
    )
    planting_window_reason: str = Field(
        description="A short explanation based on the crop, location, supplied conditions, and Sabah seasonality."
    )
    confidence_level: Literal["Low", "Medium", "High"] = Field(
        description="Confidence based on sample count, missing data, and supplied confidence text."
    )
    missing_data: list[str] = Field(
        description="Missing, null, unavailable, or uncertain values. Do not guess."
    )

INSIGHT_FIELD_ALIASES = {
    "crop_suitability_summary": (
        "crop_suitability_summary",
        "cropSuitabilitySummary",
        "Crop Suitability Summary",
    ),
    "key_strengths": ("key_strengths", "keyStrengths", "Key Strengths"),
    "potential_risks": ("potential_risks", "potentialRisks", "Potential Risks"),
    "recommended_actions": ("recommended_actions", "recommendedActions", "Recommended Actions"),
    "best_planting_months": (
        "best_planting_months",
        "bestPlantingMonths",
        "Best Planting Months",
    ),
    "planting_window_reason": (
        "planting_window_reason",
        "plantingWindowReason",
        "Planting Window Reason",
    ),
    "confidence_level": ("confidence_level", "confidenceLevel", "Confidence Level"),
    "missing_data": ("missing_data", "missingData", "Missing Data"),
}


def build_gemini_ai_insight(
    *,
    crop,
    district: str | None,
    area_hectares: float | None,
    environment: dict,
    suitability: dict,
    recommendations: list[str],
    planting_window: dict,
    return_estimate: dict,
    fallback: str,
) -> dict:
    """Generate crop guidance from structured environmental data only."""
    fallback_insight = prepare_insight_missing_data(
        build_rule_based_insight(
            crop=crop,
            district=district,
            environment=environment,
            suitability=suitability,
            recommendations=recommendations,
            planting_window=planting_window,
            fallback_summary=fallback,
        ),
        environment=environment,
    )
    api_key = get_gemini_api_key()
    if not api_key:
        logger.info("Gemini AI insight skipped because no Gemini API key is configured.")
        return with_fallback_metadata(fallback_insight, "Gemini API key is not configured.")

    model = os.getenv("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL
    prompt = build_prediction_insight_prompt(
        crop=crop,
        district=district,
        area_hectares=area_hectares,
        environment=environment,
        suitability=suitability,
        recommendations=recommendations,
        planting_window=planting_window,
        return_estimate=return_estimate,
    )
    try:
        insight = build_langchain_structured_insight(
            api_key=api_key, model=model, prompt=prompt, fallback_insight=fallback_insight,
        )
        return prepare_insight_missing_data(insight, environment=environment)
    except ModuleNotFoundError:
        logger.info("LangChain Gemini client is not installed; using the direct Gemini REST API instead.")
    except Exception as exc:
        logger.warning("LangChain Gemini structured insight failed: %s", exc)
        return with_fallback_metadata(fallback_insight, "LangChain Gemini structured output failed.")

    try:
        import requests
    except ModuleNotFoundError:
        logger.warning("Gemini AI insight skipped because the requests package is not installed.")
        return with_fallback_metadata(fallback_insight, "The requests package is not installed.")

    try:
        response = requests.post(
            GEMINI_ENDPOINT_TEMPLATE.format(model=model),
            headers={"x-goog-api-key": api_key},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "topP": 0.8,
                    "maxOutputTokens": 700,
                    "responseMimeType": "application/json",
                },
            },
            timeout=15,
        )
        response.raise_for_status()
        response_payload = response.json()
        validate_gemini_finish_reason(response_payload)
        payload = parse_insight_json(extract_gemini_text(response_payload))
        insight = normalize_insight_response(payload, fallback_insight, source="gemini", model=model)
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "unknown"
        logger.warning("Gemini AI insight request failed with status %s.", status_code)
        return with_fallback_metadata(fallback_insight, gemini_http_error_reason(status_code))
    except requests.RequestException:
        logger.warning("Gemini AI insight request failed before a valid response was received.")
        return with_fallback_metadata(fallback_insight, "Gemini request failed before a valid response was received.")
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("Gemini AI insight response could not be parsed: %s", exc)
        return with_fallback_metadata(fallback_insight, "Gemini returned an unusable response.")

    return prepare_insight_missing_data(insight, environment=environment)


def gemini_http_error_reason(status_code) -> str:
    if status_code == 429:
        return "Gemini quota is exhausted. Try again after the quota resets or increase the API quota."
    return f"Gemini request failed with status {status_code}."


def get_gemini_api_key() -> str | None:
    key_names = ("GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "VITE_GOOGLE_GEMINI_API_KEY")
    for key_name in key_names:
        value = str(os.getenv(key_name) or "").strip()
        if value:
            return value

    if dotenv_values is not None:
        env_values = dotenv_values(BACKEND_ENV_PATH)
        for key_name in key_names:
            value = str(env_values.get(key_name) or "").strip()
            if value:
                return value

    return None


def build_langchain_structured_insight(
    *,
    api_key: str,
    model: str,
    prompt: str,
    fallback_insight: dict,
) -> dict:
    from langchain_google_genai import ChatGoogleGenerativeAI

    llm = ChatGoogleGenerativeAI(
        model=model,
        api_key=api_key,
        temperature=0.2,
        max_tokens=700,
        timeout=15,
        max_retries=1,
    )
    structured_llm = llm.with_structured_output(
        schema=get_pydantic_json_schema(PredictionInsightOutput),
        method="json_schema",
    )
    payload = structured_llm.invoke(prompt)

    if hasattr(payload, "model_dump"):
        payload = payload.model_dump()

    if not isinstance(payload, dict):
        raise ValueError("LangChain Gemini insight must return a JSON object.")

    return normalize_insight_response(
        payload,
        fallback_insight,
        source="gemini_langchain",
        model=model,
    )


def get_pydantic_json_schema(model_class: type[BaseModel]) -> dict:
    schema_builder = getattr(model_class, "model_json_schema", None)
    if schema_builder is not None:
        return schema_builder()
    return model_class.schema()


def validate_gemini_finish_reason(payload: dict) -> None:
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not candidates:
        raise ValueError("Gemini response did not contain a candidate.")

    finish_reason = str(candidates[0].get("finishReason") or "STOP").upper()
    if finish_reason != "STOP":
        raise ValueError(f"Gemini response ended with {finish_reason}.")


def build_prediction_insight_prompt(
    *,
    crop,
    district: str | None,
    area_hectares: float | None,
    environment: dict,
    suitability: dict,
    recommendations: list[str],
    planting_window: dict,
    return_estimate: dict,
) -> str:
    values = environment.get("values", {})
    land_cover_value = get_detected_land_cover_value(values)
    missing_or_uncertain_data = get_missing_fields_with_land_cover(values)
    payload = {
        "crop_name": getattr(crop, "name", str(crop)),
        "scientific_name": getattr(crop, "scientific_name", None),
        "district_or_location": district or "selected map area",
        "area_hectares": area_hectares,
        "suitability_score": suitability.get("score"),
        "suitability_status": suitability.get("status"),
        "sample_count": environment.get("sample_count"),
        "rainfall_mm": values.get("rainfall_mm"),
        "temperature_c": values.get("temperature_c"),
        "ph": values.get("soil_ph"),
        "soil_depth_cm": values.get("soil_depth_cm"),
        "solar_radiation": values.get("solar_radiation"),
        "root_zone_moisture": values.get("root_zone_moisture"),
        "soil_nutrients": {
            "nitrogen": values.get("nitrogen"),
            "soc": values.get("soc"),
            "organic_carbon": values.get("organic_carbon"),
        },
        "terrain": {
            "elevation_m": values.get("elevation_m") or values.get("dem_m"),
            "slope_pct": values.get("slope_pct"),
            "slope_deg": values.get("slope_deg"),
        },
        "land_cover": land_cover_value,
        "strengths": sanitize_for_json(suitability.get("strengths", [])),
        "weaknesses_or_risks": sanitize_for_json(
            suitability.get("risk_warnings") or suitability.get("limitations", [])
        ),
        "recommendations": sanitize_for_json(recommendations),
        "missing_or_uncertain_data": sanitize_for_json(missing_or_uncertain_data),
        "overridden_fields": sanitize_for_json(values.get("overridden_fields", [])),
        "planting_window": sanitize_for_json(planting_window),
        "return_estimate": sanitize_for_json(return_estimate),
    }

    output_keys = (
        "crop_suitability_summary, key_strengths, potential_risks, recommended_actions, "
        "best_planting_months, planting_window_reason, confidence_level, missing_data"
    )
    return (
        "You are Agrow's agronomy AI assistant for crop planning in Sabah, Malaysia. "
        "Use only the supplied analysis data. Do not invent measurements, prices, yields, location facts, or protected-land status. "
        "The prediction data contains final merged environment values, with spatial_grids point values preferred over existing raster/current fallback values. "
        "Return ONLY valid JSON with exactly these keys: "
        f"{output_keys}. "
        "Do not wrap the JSON in markdown. Keep the same keys for every crop. "
        "The summary must be one farmer-friendly sentence. Each list should contain 2 to 4 short farmer-friendly items when possible. "
        "For best_planting_months, use 2 to 4 full English month names based on the selected crop, district or Sabah location, "
        "the supplied annual conditions, and your general knowledge of Sabah rainfall seasonality. "
        "Do not invent monthly rainfall measurements. planting_window_reason must clearly state that the recommendation is "
        "AI seasonal guidance rather than a weather forecast or measured monthly result. "
        "confidence_level must be exactly Low, Medium, or High based on the supplied sample count, missing data, and confidence text. "
        "If a value is null, unavailable, or uncertain, mention that in missing_data instead of guessing. "
        "Do not treat nitrogen, bdod/bulk density, silt, sand, clay, cec/cation exchange capacity, "
        "soc/soil organic carbon, or organic carbon as missing data; "
        "omit them from missing_data even when they are null or unavailable. "
        "Land cover is contextual environmental data, not a verified developed-area check. "
        "Do not claim to have inspected satellite imagery or verified development or planting permission. "
        "Still return valid JSON using the exact same keys.\n\n"
        f"Prediction data:\n{json.dumps(payload, ensure_ascii=True, indent=2)}"
    )


def build_rule_based_insight(
    *,
    crop,
    district: str | None,
    environment: dict,
    suitability: dict,
    recommendations: list[str],
    planting_window: dict,
    fallback_summary: str,
) -> dict:
    values = environment.get("values", {})
    crop_name = getattr(crop, "name", str(crop))
    location = district or "the selected area"
    score = suitability.get("score")
    status = suitability.get("status") or "pending review"
    score_text = f" with a suitability score of {score}/100" if score is not None else ""
    summary = fallback_summary or (
        f"{crop_name} is {str(status).lower()} for {location}{score_text} based on the supplied soil, climate, and terrain data."
    )

    risks = suitability.get("risk_warnings") or suitability.get("limitations")

    return {
        "crop_suitability_summary": summary,
        "key_strengths": clean_text_list(
            suitability.get("strengths"),
            ["The supplied database layers show usable baseline conditions for this crop."],
        ),
        "potential_risks": clean_text_list(
            risks,
            ["No major risk was identified from the supplied analysis data."],
        ),
        "recommended_actions": clean_text_list(
            recommendations or suitability.get("recommendations"),
            ["Validate the matched database values with a field inspection before planting."],
        ),
        "best_planting_months": clean_text_list(
            planting_window.get("best_months"),
            [],
        ),
        "planting_window_reason": clean_text(
            planting_window.get("reason"),
            "Planting month guidance is unavailable.",
        ),
        "confidence_level": normalize_confidence_label(suitability.get("confidence")),
        "missing_data": format_missing_fields(get_missing_fields_with_land_cover(values)),
        "source": "fallback",
        "model": None,
        "fallback_used": True,
        "fallback_reason": None,
    }


def normalize_insight_response(payload: dict, fallback_insight: dict, *, source: str, model: str | None) -> dict:
    insight = {
        "crop_suitability_summary": clean_text(
            get_insight_value(payload, "crop_suitability_summary"),
            fallback_insight["crop_suitability_summary"],
        ),
        "key_strengths": clean_text_list(
            get_insight_value(payload, "key_strengths"),
            fallback_insight["key_strengths"],
        ),
        "potential_risks": clean_text_list(
            get_insight_value(payload, "potential_risks"),
            fallback_insight["potential_risks"],
        ),
        "recommended_actions": clean_text_list(
            get_insight_value(payload, "recommended_actions"),
            fallback_insight["recommended_actions"],
        ),
        "best_planting_months": clean_text_list(
            get_insight_value(payload, "best_planting_months"),
            fallback_insight["best_planting_months"],
        ),
        "planting_window_reason": clean_text(
            get_insight_value(payload, "planting_window_reason"),
            fallback_insight["planting_window_reason"],
        ),
        "confidence_level": normalize_confidence_label(
            get_insight_value(payload, "confidence_level"),
            fallback=fallback_insight["confidence_level"],
        ),
        "missing_data": clean_text_list(
            get_insight_value(payload, "missing_data"),
            fallback_insight["missing_data"],
        ),
        "source": source,
        "model": model,
        "fallback_used": False,
        "fallback_reason": None,
    }

    if not insight["crop_suitability_summary"]:
        raise ValueError("Gemini insight is missing a crop suitability summary.")

    return insight


def prepare_insight_missing_data(insight: dict, *, environment: dict) -> dict:
    values = environment.get("values", {}) if isinstance(environment, dict) else {}
    return ensure_land_cover_missing_data(filter_ignored_missing_data(dict(insight)), values)


def ensure_land_cover_missing_data(insight: dict, values: dict) -> dict:
    land_cover_value = get_detected_land_cover_value(values)
    if not is_missing_or_unknown_land_cover(land_cover_value):
        return insight

    missing_data = clean_text_list(insight.get("missing_data"), [], limit=6)
    missing_data = [
        item for item in missing_data if item.lower() != DEFAULT_MISSING_DATA_MESSAGE.lower()
    ]
    insight["missing_data"] = append_unique_text(
        missing_data,
        LAND_COVER_MISSING_MESSAGE,
        limit=6,
    )
    return insight


def get_missing_fields_with_land_cover(values: dict) -> list:
    fields = list(values.get("missing_fields") or []) if isinstance(values, dict) else []
    fields = [field for field in fields if normalize_missing_field(field) not in IGNORED_MISSING_DATA_FIELDS]
    if not is_missing_or_unknown_land_cover(get_detected_land_cover_value(values)):
        return fields

    normalized_fields = {str(field or "").strip().lower() for field in fields}
    if not normalized_fields.intersection(LAND_COVER_PAYLOAD_FIELDS):
        fields.append("land_cover")
    return fields


def filter_ignored_missing_data(insight: dict) -> dict:
    missing_data = clean_text_list(insight.get("missing_data"), [], limit=6)
    filtered = [item for item in missing_data if not mentions_ignored_missing_field(item)]
    insight["missing_data"] = filtered or [DEFAULT_MISSING_DATA_MESSAGE]
    return insight


def normalize_missing_field(field) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(field or "").strip().lower()).strip("_")


def mentions_ignored_missing_field(item) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", " ", str(item or "").lower()).strip()
    return any(re.search(rf"\b{re.escape(term)}\b", normalized) for term in IGNORED_MISSING_DATA_TERMS)


def get_detected_land_cover_value(values: dict) -> str | None:
    if not isinstance(values, dict):
        return None

    for field in LAND_COVER_PAYLOAD_FIELDS:
        value = values.get(field)
        if value is None:
            continue

        text = str(value).strip()
        if text:
            return text

    return None


def is_missing_or_unknown_land_cover(value) -> bool:
    normalized = normalize_land_cover_value(value)
    if not normalized:
        return True
    return normalized in UNKNOWN_LAND_COVER_VALUES or "unknown" in normalized


def normalize_land_cover_value(value) -> str:
    return " ".join(str(value or "").replace("_", " ").replace("-", " ").lower().split())


def prepend_unique_text(items, text: str, limit: int = 4) -> list[str]:
    target = clean_text(text)
    cleaned = [
        item for item in clean_text_list(items, [], limit=limit)
        if item.lower() != target.lower()
    ]
    return ([target] + cleaned)[:limit] if target else cleaned[:limit]


def append_unique_text(items, text: str, limit: int = 4) -> list[str]:
    target = clean_text(text)
    cleaned = clean_text_list(items, [], limit=limit)
    if not target or any(item.lower() == target.lower() for item in cleaned):
        return cleaned[:limit]

    if len(cleaned) >= limit:
        cleaned = cleaned[: limit - 1]
    return cleaned + [target]


def with_fallback_metadata(fallback_insight: dict, reason: str) -> dict:
    return {
        **fallback_insight,
        "source": "fallback",
        "model": None,
        "fallback_used": True,
        "fallback_reason": reason,
    }


def get_insight_value(payload: dict, field: str):
    for alias in INSIGHT_FIELD_ALIASES[field]:
        if alias in payload:
            return payload[alias]
    return None


def parse_insight_json(text: str) -> dict:
    cleaned = strip_json_markdown(text)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        payload = json.loads(cleaned[start : end + 1])

    if not isinstance(payload, dict):
        raise ValueError("Gemini insight JSON must be an object.")

    return payload


def strip_json_markdown(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned.startswith("```"):
        return cleaned

    lines = cleaned.splitlines()
    if lines and lines[0].strip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def clean_text(value, fallback: str = "") -> str:
    text = " ".join(str(value or "").split())
    return text or fallback


def clean_text_list(value, fallback: list[str], limit: int = 4) -> list[str]:
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, (list, tuple)):
        values = value
    else:
        values = []

    cleaned = []
    seen = set()
    for item in values:
        text = clean_text(item)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        cleaned.append(text)
        seen.add(key)
        if len(cleaned) >= limit:
            break

    return cleaned or list(fallback)


def normalize_confidence_label(value, fallback: str = "Medium") -> str:
    text = str(value or "").lower()
    if "high" in text:
        return "High"
    if "low" in text:
        return "Low"
    if "medium" in text or "moderate" in text:
        return "Medium"
    return fallback if fallback in {"Low", "Medium", "High"} else "Medium"


def format_missing_fields(fields) -> list[str]:
    if not fields:
        return [DEFAULT_MISSING_DATA_MESSAGE]

    return clean_text_list(
        [humanize_field_name(field) for field in fields],
        [DEFAULT_MISSING_DATA_MESSAGE],
        limit=6,
    )


def humanize_field_name(field) -> str:
    label = str(field or "").replace("_", " ").strip()
    return f"{label} is missing." if label else DEFAULT_MISSING_DATA_MESSAGE


def extract_gemini_text(payload: dict) -> str:
    parts = payload["candidates"][0]["content"]["parts"]
    return " ".join(str(part.get("text", "")).strip() for part in parts).strip()


def sanitize_for_json(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        if isinstance(value, dict):
            return {key: sanitize_for_json(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [sanitize_for_json(item) for item in value]
        return str(value)
