"""Shared crop discovery helpers for training and runtime APIs.

The trained model metadata is the runtime snapshot of the crop registry.  It is
written by ``train_model.py`` after validating the database crop requirements,
historical statistics, and environmental samples.  Keeping this small module
free of API concerns lets the training pipeline, prediction endpoints, and
statistics endpoints agree on the same crop names and support status.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import joblib


ML_ASSETS_DIR = Path(__file__).resolve().parents[1] / "ml_assets"
MODEL_METADATA_PATH = ML_ASSETS_DIR / "crop_model_metadata.json"
MODEL_ENCODER_PATH = ML_ASSETS_DIR / "crop_encoder.joblib"

REQUIRED_SUITABILITY_FIELDS = (
    "min_temp_limit",
    "ideal_temp_min",
    "ideal_temp_max",
    "max_temp_limit",
    "min_annual_rainfall",
    "min_soil_depth_cm",
    "ideal_ph_min",
    "ideal_ph_max",
    "max_slope_pct",
)

REQUIRED_ENVIRONMENT_FIELDS = (
    "elevation_meters",
    "slope_pct",
    "soil_ph",
    "soil_depth_cm",
    "annual_rainfall_mm",
    "solar_radiation",
    "root_zone_moisture",
)

# These are evidence sufficiency checks, not agronomic thresholds.  A crop needs
# observations in at least three years and five positive crop-statistic rows so
# that productive environmental ranges are not inferred from a one-off record.
MIN_PRODUCTIVE_STATISTIC_RECORDS = 5
MIN_PRODUCTIVE_YEARS = 3
MIN_COMPLETE_ENVIRONMENT_SAMPLES = 30


def normalize_crop_name(value: object) -> str:
    """Return a stable, case-insensitive crop key without changing punctuation."""

    return " ".join(str(value or "").strip().casefold().split())


def compact_crop_name(value: object) -> str:
    """Return a punctuation-insensitive key used only for unambiguous matching."""

    return re.sub(r"[^0-9a-z]+", "", normalize_crop_name(value))


def match_crop_names(
    requirement_names: list[str] | tuple[str, ...],
    statistic_names: list[str] | tuple[str, ...],
) -> tuple[dict[str, str], dict[str, str]]:
    """Match requirement names to statistics names without a crop-specific map.

    Exact case-insensitive matches win.  A punctuation-insensitive match is used
    only when it is unique on both sides; this safely reconciles names such as
    ``Watercress`` and ``Water-Cress`` without collapsing ambiguous duplicates.
    The second return value contains unmatched requirement names and a reason.
    """

    requirements = [str(name).strip() for name in requirement_names if str(name).strip()]
    statistics = [str(name).strip() for name in statistic_names if str(name).strip()]
    statistics_by_key = {normalize_crop_name(name): name for name in statistics}

    requirement_compact_counts: dict[str, int] = {}
    statistic_compact_names: dict[str, list[str]] = {}
    for name in requirements:
        key = compact_crop_name(name)
        requirement_compact_counts[key] = requirement_compact_counts.get(key, 0) + 1
    for name in statistics:
        statistic_compact_names.setdefault(compact_crop_name(name), []).append(name)

    matches: dict[str, str] = {}
    unmatched: dict[str, str] = {}
    for requirement_name in requirements:
        exact_match = statistics_by_key.get(normalize_crop_name(requirement_name))
        if exact_match:
            matches[requirement_name] = exact_match
            continue

        compact_key = compact_crop_name(requirement_name)
        compact_matches = statistic_compact_names.get(compact_key, [])
        if (
            compact_key
            and requirement_compact_counts.get(compact_key) == 1
            and len(compact_matches) == 1
        ):
            matches[requirement_name] = compact_matches[0]
            continue

        unmatched[requirement_name] = "No unambiguous historical crop-statistics match."

    return matches, unmatched


def load_model_metadata() -> dict:
    """Load the registry snapshot bundled with the current model."""

    try:
        with MODEL_METADATA_PATH.open("r", encoding="utf-8") as metadata_file:
            payload = json.load(metadata_file)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def get_trained_crop_names() -> tuple[str, ...]:
    """Return crop names supported by the currently deployed model assets."""

    metadata = load_model_metadata()
    crop_names = metadata.get("trained_crop_names")
    if isinstance(crop_names, list):
        cleaned_names = tuple(
            str(name).strip() for name in crop_names if str(name).strip()
        )
        if cleaned_names:
            return cleaned_names

    # Backward-compatible discovery for a model created before metadata existed.
    try:
        encoder = joblib.load(MODEL_ENCODER_PATH)
        encoder_names = getattr(encoder, "classes_", ())
        if len(encoder_names) == 0 and getattr(encoder, "categories_", None):
            encoder_names = encoder.categories_[0]
        return tuple(
            str(name).strip()
            for name in encoder_names
            if str(name).strip()
        )
    except Exception:
        return ()


def canonical_trained_crop_name(value: object) -> str | None:
    requested_key = normalize_crop_name(value)
    if not requested_key:
        return None
    return next(
        (
            crop_name
            for crop_name in get_trained_crop_names()
            if normalize_crop_name(crop_name) == requested_key
        ),
        None,
    )


def get_crop_registry_entry(value: object) -> dict | None:
    """Find a registry row by either requirement or statistics crop name."""

    requested_key = normalize_crop_name(value)
    requested_compact_key = compact_crop_name(value)
    registry_rows = load_model_metadata().get("crop_registry")
    registry_rows = registry_rows if isinstance(registry_rows, list) else []

    for row in registry_rows:
        if not isinstance(row, dict):
            continue
        names = (row.get("crop_name"), row.get("statistics_crop_name"))
        if any(normalize_crop_name(name) == requested_key for name in names if name):
            return row

    compact_matches = [
        row
        for row in registry_rows
        if isinstance(row, dict)
        and any(
            compact_crop_name(name) == requested_compact_key
            for name in (row.get("crop_name"), row.get("statistics_crop_name"))
            if name
        )
    ]
    return compact_matches[0] if requested_compact_key and len(compact_matches) == 1 else None


def get_statistics_crop_support(crop_names: list[str]) -> list[dict]:
    """Describe prediction support for names exposed by Crop Statistics."""

    metadata = load_model_metadata()
    registry_rows = metadata.get("crop_registry")
    registry_rows = registry_rows if isinstance(registry_rows, list) else []
    trained_names = get_trained_crop_names()

    support_by_statistics_key: dict[str, dict] = {}
    compact_support: dict[str, list[dict]] = {}
    for row in registry_rows:
        if not isinstance(row, dict):
            continue
        statistics_name = str(row.get("statistics_crop_name") or "").strip()
        if not statistics_name:
            continue
        support_by_statistics_key[normalize_crop_name(statistics_name)] = row
        compact_support.setdefault(compact_crop_name(statistics_name), []).append(row)

    options = []
    for statistics_name in crop_names:
        registry_row = support_by_statistics_key.get(normalize_crop_name(statistics_name))
        if registry_row is None:
            compact_rows = compact_support.get(compact_crop_name(statistics_name), [])
            if len(compact_rows) == 1:
                registry_row = compact_rows[0]

        prediction_crop_name = None
        exclusion_reasons: list[str] = []
        if registry_row:
            candidate = str(registry_row.get("crop_name") or "").strip()
            if registry_row.get("ml_supported") and candidate:
                prediction_crop_name = canonical_trained_crop_name(candidate)
            raw_reasons = registry_row.get("exclusion_reasons")
            if isinstance(raw_reasons, list):
                exclusion_reasons = [str(reason) for reason in raw_reasons]
        else:
            exact = next(
                (
                    name
                    for name in trained_names
                    if normalize_crop_name(name) == normalize_crop_name(statistics_name)
                ),
                None,
            )
            prediction_crop_name = exact
            if not exact:
                exclusion_reasons = [
                    "This historical crop is not included in the current model registry."
                ]

        ml_supported = prediction_crop_name is not None
        options.append(
            {
                "name": statistics_name,
                "ml_supported": ml_supported,
                "prediction_crop_name": prediction_crop_name,
                "ml_status": "supported" if ml_supported else "statistics_only",
                "exclusion_reasons": exclusion_reasons,
            }
        )

    return options
