import base64
import binascii
import re

MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024
SUPPORTED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
DATA_URL_PATTERN = re.compile(
    r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$",
    re.IGNORECASE,
)

SATELLITE_VISION_INSTRUCTIONS = """
Analyze this overhead satellite-map crop inside the highlighted farm boundary. Pixels outside the
selected polygon may be black or transparent and must be ignored. Determine whether visible roofs,
building clusters, paved compounds, or dense developed surfaces make the selected site a built-up
area. Roads by themselves are not buildings. Do not infer buildings from labels or surrounding
masked pixels. If the image is too blurry, too zoomed out, obscured, or mostly missing, mark the
image quality unusable and do not guess. Set buildings_detected true when at least one clear building
roof or cluster is visible. Set is_built_up true only when development occupies a material part of the
selected site or clearly makes normal crop planting unsuitable. Estimate developed coverage from 0
to 100 and give one short explanation based only on visible evidence.
""".strip()


def decode_image_data_url(image_data_url: str) -> tuple[str, str, int]:
    match = DATA_URL_PATTERN.fullmatch(str(image_data_url or "").strip())
    if not match:
        raise ValueError("Satellite image must be a base64 PNG, JPEG, or WebP data URL.")

    mime_type = match.group(1).lower()
    image_base64 = re.sub(r"\s+", "", match.group(2))
    if mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
        raise ValueError("Satellite image type is not supported.")

    try:
        image_bytes = base64.b64decode(image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Satellite image data is not valid base64.") from exc

    if not image_bytes:
        raise ValueError("Satellite image is empty.")
    if len(image_bytes) > MAX_INLINE_IMAGE_BYTES:
        raise ValueError("Satellite image is larger than the 7 MB analysis limit.")

    validate_image_signature(image_bytes, mime_type)
    return mime_type, image_base64, len(image_bytes)


def validate_image_signature(image_bytes: bytes, mime_type: str) -> None:
    signatures = {
        "image/png": image_bytes.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": image_bytes.startswith(b"\xff\xd8\xff"),
        "image/webp": image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP",
    }
    if not signatures.get(mime_type, False):
        raise ValueError("Satellite image content does not match its declared image type.")


def satellite_response_schema() -> dict:
    return {
        "type": "OBJECT",
        "properties": {
            "buildings_detected": {"type": "BOOLEAN"},
            "is_built_up": {"type": "BOOLEAN"},
            "estimated_built_up_percent": {"type": "NUMBER", "minimum": 0, "maximum": 100},
            "confidence": {"type": "STRING", "enum": ["low", "medium", "high"]},
            "image_quality": {"type": "STRING", "enum": ["usable", "limited", "unusable"]},
            "explanation": {"type": "STRING"},
        },
        "required": [
            "buildings_detected",
            "is_built_up",
            "estimated_built_up_percent",
            "confidence",
            "image_quality",
            "explanation",
        ],
    }


def normalize_satellite_analysis(payload: dict, *, model: str, image_size: int) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Satellite analysis must be a JSON object.")

    buildings_detected = require_boolean(payload.get("buildings_detected"), "buildings_detected")
    is_built_up = require_boolean(payload.get("is_built_up"), "is_built_up")
    confidence = normalize_choice(payload.get("confidence"), {"low", "medium", "high"}, "confidence")
    image_quality = normalize_choice(
        payload.get("image_quality"),
        {"usable", "limited", "unusable"},
        "image_quality",
    )
    try:
        built_up_percent = min(100.0, max(0.0, float(payload.get("estimated_built_up_percent"))))
    except (TypeError, ValueError) as exc:
        raise ValueError("estimated_built_up_percent must be numeric.") from exc

    explanation = " ".join(str(payload.get("explanation") or "").split()).strip()
    if not explanation:
        raise ValueError("Satellite analysis explanation is missing.")

    override_recommended = bool(
        buildings_detected
        and is_built_up
        and image_quality == "usable"
        and (confidence == "high" or (confidence == "medium" and built_up_percent >= 25.0))
    )

    return {
        "status": "analyzed",
        "buildings_detected": buildings_detected,
        "is_built_up": is_built_up,
        "estimated_built_up_percent": round(built_up_percent, 1),
        "confidence": confidence,
        "image_quality": image_quality,
        "explanation": explanation,
        "land_cover_override_recommended": override_recommended,
        "model": model,
        "image_bytes": image_size,
        "failure_reason": None,
    }


def require_boolean(value, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    raise ValueError(f"{field_name} must be boolean.")


def normalize_choice(value, choices: set[str], field_name: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in choices:
        raise ValueError(f"{field_name} has an unsupported value.")
    return normalized


def unavailable_analysis(reason: str, *, model: str | None = None) -> dict:
    return {
        "status": "unavailable",
        "buildings_detected": None,
        "is_built_up": None,
        "estimated_built_up_percent": None,
        "confidence": None,
        "image_quality": None,
        "explanation": None,
        "land_cover_override_recommended": False,
        "model": model,
        "image_bytes": None,
        "failure_reason": reason,
    }
