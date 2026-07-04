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
) -> str:
    api_key = (
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_GEMINI_API_KEY")
        or os.getenv("VITE_GOOGLE_GEMINI_API_KEY")
    )
    if not api_key:
        logger.info("Gemini AI insight skipped because no Gemini API key is configured.")
        return fallback

    try:
        import requests
    except ModuleNotFoundError:
        logger.warning("Gemini AI insight skipped because the requests package is not installed.")
        return fallback

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
                    "temperature": 0.35,
                    "topP": 0.9,
                    "maxOutputTokens": 220,
                },
            },
            timeout=15,
        )
        response.raise_for_status()
        insight = extract_gemini_text(response.json())
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "unknown"
        logger.warning("Gemini AI insight request failed with status %s.", status_code)
        return fallback
    except requests.RequestException:
        logger.warning("Gemini AI insight request failed before a valid response was received.")
        return fallback
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("Gemini AI insight response could not be parsed: %s", exc)
        return fallback

    return insight or fallback


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
        "crop": getattr(crop, "name", str(crop)),
        "scientific_name": getattr(crop, "scientific_name", None),
        "district": district,
        "area_hectares": area_hectares,
        "sample_count": environment.get("sample_count"),
        "environment": sanitize_for_json(values),
        "suitability": sanitize_for_json(suitability),
        "recommendations": sanitize_for_json(recommendations),
        "planting_window": sanitize_for_json(planting_window),
        "return_estimate": sanitize_for_json(return_estimate),
    }

    return (
        "You are Agrow's agronomy AI assistant for crop planning in Sabah, Malaysia. "
        "Use only the supplied database values. Do not invent measurements, prices, yields, or protected-land status. "
        "Write one clear paragraph of 70 to 110 words for a farmer or planner. "
        "Explain why the selected area is suitable or risky, mention the strongest factor and the main limitation, "
        "and end with one practical next step. Avoid markdown, bullets, and JSON.\n\n"
        f"Prediction data:\n{json.dumps(payload, ensure_ascii=True, indent=2)}"
    )


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
