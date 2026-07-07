import json
import logging
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None


if load_dotenv is not None:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logger = logging.getLogger(__name__)

DEFAULT_GEMINI_MODEL = "gemini-1.5-flash"
GEMINI_ENDPOINT_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MISSING_DATA_MESSAGE = "No major missing data was flagged in the current analysis."

INSIGHT_FIELD_ALIASES = {
    "crop_suitability_summary": (
        "crop_suitability_summary",
        "cropSuitabilitySummary",
        "Crop Suitability Summary",
    ),
    "key_strengths": ("key_strengths", "keyStrengths", "Key Strengths"),
    "potential_risks": ("potential_risks", "potentialRisks", "Potential Risks"),
    "recommended_actions": ("recommended_actions", "recommendedActions", "Recommended Actions"),
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
    fallback_insight = build_rule_based_insight(
        crop=crop,
        district=district,
        environment=environment,
        suitability=suitability,
        recommendations=recommendations,
        fallback_summary=fallback,
    )
    api_key = (
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_GEMINI_API_KEY")
        or os.getenv("VITE_GOOGLE_GEMINI_API_KEY")
    )
    if not api_key:
        logger.info("Gemini AI insight skipped because no Gemini API key is configured.")
        return with_fallback_metadata(fallback_insight, "Gemini API key is not configured.")

    try:
        import requests
    except ModuleNotFoundError:
        logger.warning("Gemini AI insight skipped because the requests package is not installed.")
        return with_fallback_metadata(fallback_insight, "The requests package is not installed.")

    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
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
        response = requests.post(
            GEMINI_ENDPOINT_TEMPLATE.format(model=model),
            params={"key": api_key},
            json={
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": prompt}],
                    }
                ],
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
        insight = normalize_insight_response(
            parse_insight_json(extract_gemini_text(response.json())),
            fallback_insight,
            source="gemini",
            model=model,
        )
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "unknown"
        logger.warning("Gemini AI insight request failed with status %s.", status_code)
        return with_fallback_metadata(fallback_insight, f"Gemini request failed with status {status_code}.")
    except requests.RequestException:
        logger.warning("Gemini AI insight request failed before a valid response was received.")
        return with_fallback_metadata(fallback_insight, "Gemini request failed before a valid response was received.")
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("Gemini AI insight response could not be parsed: %s", exc)
        return with_fallback_metadata(fallback_insight, "Gemini returned an unusable response.")

    return insight


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
        "land_cover": values.get("land_cover"),
        "strengths": sanitize_for_json(suitability.get("strengths", [])),
        "weaknesses_or_risks": sanitize_for_json(
            suitability.get("risk_warnings") or suitability.get("limitations", [])
        ),
        "recommendations": sanitize_for_json(recommendations),
        "missing_or_uncertain_data": sanitize_for_json(values.get("missing_fields", [])),
        "overridden_fields": sanitize_for_json(values.get("overridden_fields", [])),
        "planting_window": sanitize_for_json(planting_window),
        "return_estimate": sanitize_for_json(return_estimate),
    }

    return (
        "You are Agrow's agronomy AI assistant for crop planning in Sabah, Malaysia. "
        "Use only the supplied analysis data. Do not invent measurements, prices, yields, location facts, or protected-land status. "
        "Return ONLY valid JSON with exactly these keys: "
        "crop_suitability_summary, key_strengths, potential_risks, recommended_actions, confidence_level, missing_data. "
        "Do not wrap the JSON in markdown. Keep the same keys for every crop. "
        "The summary must be one farmer-friendly sentence. Each list should contain 2 to 4 short farmer-friendly items when possible. "
        "confidence_level must be exactly Low, Medium, or High based on the supplied sample count, missing data, and confidence text. "
        "If a value is null, unavailable, or uncertain, mention that in missing_data instead of guessing.\n\n"
        f"Prediction data:\n{json.dumps(payload, ensure_ascii=True, indent=2)}"
    )


def build_rule_based_insight(
    *,
    crop,
    district: str | None,
    environment: dict,
    suitability: dict,
    recommendations: list[str],
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
        "confidence_level": normalize_confidence_label(suitability.get("confidence")),
        "missing_data": format_missing_fields(values.get("missing_fields")),
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
