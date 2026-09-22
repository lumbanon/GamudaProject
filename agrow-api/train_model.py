"""Train Agrow's crop-suitability classifier from the database crop registry.

The pipeline deliberately separates historical-statistics availability from ML
eligibility.  Every crop is reported, while only crops with complete, sourced
requirements and enough supporting historical/environmental coverage are used
to generate S1/S2/S3/N samples.
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
from sqlalchemy import create_engine, text
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from sklearn.preprocessing import OneHotEncoder

from app.database.session import DATABASE_URL
from app.services.crop_registry import (
    MIN_COMPLETE_ENVIRONMENT_SAMPLES,
    MIN_PRODUCTIVE_STATISTIC_RECORDS,
    MIN_PRODUCTIVE_YEARS,
    MODEL_METADATA_PATH,
    REQUIRED_ENVIRONMENT_FIELDS,
    REQUIRED_SUITABILITY_FIELDS,
    match_crop_names,
    normalize_crop_name,
)


MIN_PRODUCTIVE_GRID_DISTRICTS = 5
MIN_DISTINCT_SUITABILITY_CLASSES = 2
S1_MIN_MATCH_RATIO = 1.00
S2_MIN_MATCH_RATIO = 0.60
MODEL_CLASS_ORDER = ("S1", "S2", "S3", "N")
MODEL_ENVIRONMENT_FIELDS = tuple(REQUIRED_ENVIRONMENT_FIELDS)
MODEL_PARAMETER_CANDIDATES = tuple(
    {
        "max_depth": max_depth,
        "max_features": max_features,
        "n_estimators": n_estimators,
    }
    for max_depth in (18, None)
    for max_features in ("sqrt", 0.5)
    for n_estimators in (120, 180)
)
EMPIRICAL_RANGE_FIELDS = (
    "elevation_meters",
    "annual_rainfall_mm",
    "solar_radiation",
    "root_zone_moisture",
)
SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUTS_DIR = SCRIPT_DIR / "outputs"
INTEGRITY_REPORT_PATH = OUTPUTS_DIR / "crop_data_integrity_report.csv"
TRAINING_REPORT_PATH = OUTPUTS_DIR / "crop_training_report.json"
PER_CROP_METRICS_PATH = OUTPUTS_DIR / "per_crop_metrics.csv"
CONFUSION_MATRIX_PATH = OUTPUTS_DIR / "suitability_confusion_matrix.csv"


def _district_key(value) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _load_training_source(engine) -> tuple[list[dict], list[dict], list[dict]]:
    """Read crop thresholds, environmental points, and historical coverage.

    Production is evidence for eligibility and range estimation, never a model
    feature. Coordinates and grid IDs identify groups but are not predictors.
    """
    with engine.connect() as connection:
        crop_rows = connection.execute(
            text(
                """
                SELECT
                    id,
                    name,
                    scientific_name,
                    min_temp_limit,
                    ideal_temp_min,
                    ideal_temp_max,
                    max_temp_limit,
                    min_annual_rainfall,
                    min_soil_depth_cm,
                    ideal_ph_min,
                    ideal_ph_max,
                    max_slope_pct
                FROM crops
                WHERE name IS NOT NULL AND TRIM(name) <> ''
                ORDER BY lower(name)
                """
            )
        ).mappings().all()
        grid_rows = connection.execute(
            text(
                """
                SELECT
                    id,
                    district,
                    elevation_meters,
                    slope_pct,
                    soil_ph,
                    soil_depth_cm,
                    annual_rainfall_mm,
                    solar_radiation,
                    root_zone_moisture
                FROM spatial_grids
                ORDER BY id
                """
            )
        ).mappings().all()
        statistic_rows = connection.execute(
            text(
                """
                SELECT
                    crop_name,
                    district,
                    year,
                    planted_area_ha,
                    production_tonnes,
                    economic_value_myr
                FROM crop_statistics
                WHERE crop_name IS NOT NULL AND TRIM(crop_name) <> ''
                ORDER BY lower(crop_name), year, lower(district)
                """
            )
        ).mappings().all()

    return (
        [dict(row) for row in crop_rows],
        [dict(row) for row in grid_rows],
        [dict(row) for row in statistic_rows],
    )


def _complete_environment_grids(grids: list[dict]) -> list[dict]:
    # Incomplete rows are excluded rather than filled with invented measurements.
    return [
        grid
        for grid in grids
        if all(grid.get(field_name) is not None for field_name in REQUIRED_ENVIRONMENT_FIELDS)
        and str(grid.get("district") or "").strip()
    ]


def _split_environment_grids(
    grids: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Hold out complete districts before any empirical ranges are calculated."""

    grid_frame = pd.DataFrame(
        {
            "grid_id": [int(grid["id"]) for grid in grids],
            "district_key": [_district_key(grid["district"]) for grid in grids],
        }
    )
    splitter = GroupShuffleSplit(
        n_splits=1,
        test_size=0.20,
        random_state=42,
    )
    train_indices, test_indices = next(
        splitter.split(grid_frame, groups=grid_frame["district_key"])
    )
    train_ids = set(grid_frame.iloc[train_indices]["grid_id"])
    test_ids = set(grid_frame.iloc[test_indices]["grid_id"])
    return (
        [grid for grid in grids if int(grid["id"]) in train_ids],
        [grid for grid in grids if int(grid["id"]) in test_ids],
    )


def _validate_requirement_values(crop: dict) -> list[str]:
    """Reject incomplete or contradictory crop thresholds before generating labels."""
    missing_fields = [
        field_name
        for field_name in REQUIRED_SUITABILITY_FIELDS
        if crop.get(field_name) is None
    ]
    reasons = []
    if missing_fields:
        reasons.append(
            "Missing suitability requirement field(s): " + ", ".join(missing_fields) + "."
        )
        return reasons

    if not (
        float(crop["min_temp_limit"])
        <= float(crop["ideal_temp_min"])
        <= float(crop["ideal_temp_max"])
        <= float(crop["max_temp_limit"])
    ):
        reasons.append("Temperature requirement ranges are internally inconsistent.")
    if float(crop["ideal_ph_min"]) > float(crop["ideal_ph_max"]):
        reasons.append("Soil-pH requirement range is internally inconsistent.")
    for field_name in (
        "min_annual_rainfall",
        "min_soil_depth_cm",
        "max_slope_pct",
    ):
        if float(crop[field_name]) < 0:
            reasons.append(f"Suitability requirement {field_name} cannot be negative.")
    return reasons


def _statistics_by_name(statistics: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in statistics:
        grouped[normalize_crop_name(row.get("crop_name"))].append(row)
    return grouped


def _build_registry(
    crops: list[dict],
    grids: list[dict],
    statistics: list[dict],
) -> tuple[list[dict], dict[str, list[dict]], list[dict]]:
    """Keep historical crop availability separate from eligibility for this model."""
    complete_grids = _complete_environment_grids(grids)
    grid_districts = {
        _district_key(grid["district"])
        for grid in complete_grids
    }
    statistic_names = sorted(
        {
            str(row.get("crop_name") or "").strip()
            for row in statistics
            if str(row.get("crop_name") or "").strip()
        },
        key=lambda name: (name.casefold(), name),
    )
    requirement_names = [str(crop["name"]).strip() for crop in crops]
    name_matches, unmatched_requirements = match_crop_names(
        requirement_names,
        statistic_names,
    )
    grouped_statistics = _statistics_by_name(statistics)

    registry = []
    crop_statistics_rows: dict[str, list[dict]] = {}
    for crop in crops:
        crop_name = str(crop["name"]).strip()
        statistics_name = name_matches.get(crop_name)
        matching_statistics = (
            grouped_statistics.get(normalize_crop_name(statistics_name), [])
            if statistics_name
            else []
        )
        crop_statistics_rows[crop_name] = matching_statistics
        productive_rows = [
            row
            for row in matching_statistics
            if float(row.get("production_tonnes") or 0) > 0
        ]
        productive_years = {
            int(row["year"])
            for row in productive_rows
            if row.get("year") is not None
        }
        productive_districts = {
            _district_key(row.get("district"))
            for row in productive_rows
            if _district_key(row.get("district"))
        }
        matched_productive_districts = productive_districts & grid_districts

        requirement_reasons = _validate_requirement_values(crop)
        exclusion_reasons = list(requirement_reasons)
        if not statistics_name:
            exclusion_reasons.append(
                unmatched_requirements.get(
                    crop_name,
                    "No historical crop-statistics record was found.",
                )
            )
        elif len(productive_rows) < MIN_PRODUCTIVE_STATISTIC_RECORDS:
            exclusion_reasons.append(
                "Only "
                f"{len(productive_rows)} positive-production historical record(s); "
                f"at least {MIN_PRODUCTIVE_STATISTIC_RECORDS} are required."
            )
        if statistics_name and len(productive_years) < MIN_PRODUCTIVE_YEARS:
            exclusion_reasons.append(
                "Positive production covers only "
                f"{len(productive_years)} year(s); at least {MIN_PRODUCTIVE_YEARS} are required."
            )
        if statistics_name and len(matched_productive_districts) < MIN_PRODUCTIVE_GRID_DISTRICTS:
            exclusion_reasons.append(
                "Positive production matches only "
                f"{len(matched_productive_districts)} environmental-grid district(s); "
                f"at least {MIN_PRODUCTIVE_GRID_DISTRICTS} are required."
            )
        if len(complete_grids) < MIN_COMPLETE_ENVIRONMENT_SAMPLES:
            exclusion_reasons.append(
                "Only "
                f"{len(complete_grids)} complete environmental sample(s); "
                f"at least {MIN_COMPLETE_ENVIRONMENT_SAMPLES} are required."
            )

        registry.append(
            {
                "crop_name": crop_name,
                "scientific_name": crop.get("scientific_name"),
                "statistics_crop_name": statistics_name,
                "statistics_available": bool(matching_statistics),
                "historical_records": len(matching_statistics),
                "positive_production_records": len(productive_rows),
                "positive_production_years": len(productive_years),
                "productive_districts": len(productive_districts),
                "matched_productive_grid_districts": len(matched_productive_districts),
                "suitability_data_available": not requirement_reasons,
                "complete_environment_samples": len(complete_grids),
                "environment_data_available": (
                    len(complete_grids) >= MIN_COMPLETE_ENVIRONMENT_SAMPLES
                ),
                "generated_training_samples": 0,
                "class_distribution": {},
                "ml_supported": not exclusion_reasons,
                "exclusion_reasons": exclusion_reasons,
            }
        )

    return registry, crop_statistics_rows, complete_grids


def build_productive_environment_ranges(
    crops: list[dict],
    grids: list[dict],
    crop_statistics_rows: dict[str, list[dict]],
) -> tuple[dict[str, dict[str, tuple[float, float]]], dict[tuple[str, str], float]]:
    """Estimate 10th-90th percentile preferences from productive fit districts.

    Callers must supply only the current training partition in ``grids``;
    otherwise validation environments would influence their own target labels.
    """
    district_production: dict[tuple[str, str], float] = defaultdict(float)
    for crop in crops:
        crop_name = str(crop["name"]).strip()
        for row in crop_statistics_rows.get(crop_name, []):
            district_production[(crop_name, _district_key(row.get("district")))] += float(
                row.get("production_tonnes") or 0
            )

    ranges: dict[str, dict[str, tuple[float, float]]] = {}
    for crop in crops:
        crop_name = str(crop["name"]).strip()
        productive_grids = [
            grid
            for grid in grids
            if district_production[(crop_name, _district_key(grid.get("district")))] > 0
        ]
        crop_ranges = {}
        for field_name in EMPIRICAL_RANGE_FIELDS:
            values = [float(grid[field_name]) for grid in productive_grids]
            if values:
                series = pd.Series(values, dtype="float64")
                crop_ranges[field_name] = (
                    float(series.quantile(0.10)),
                    float(series.quantile(0.90)),
                )
        ranges[crop_name] = crop_ranges
    return ranges, district_production


def is_within_range(value, bounds) -> bool:
    if value is None or not bounds:
        return False
    lower, upper = bounds
    return lower <= float(value) <= upper


def _generate_training_samples(
    crops: list[dict],
    grids: list[dict],
    crop_statistics_rows: dict[str, list[dict]],
    *,
    range_grids: list[dict],
    train_grid_ids: set[int],
) -> pd.DataFrame:
    """Expand every eligible crop across grids and assign prototype rule labels.

    A slope/depth/rainfall veto yields N; otherwise five preference checks yield
    S1 (all match), S2 (at least three match), or S3. These are not measured
    crop outcomes, and crop-expanded rows from one grid are not independent.
    """
    productive_ranges, _district_production = build_productive_environment_ranges(
        crops,
        range_grids,
        crop_statistics_rows,
    )
    training_samples = []
    for crop in crops:
        crop_name = str(crop["name"]).strip()
        crop_ranges = productive_ranges[crop_name]
        for grid in grids:
            is_viable = (
                float(grid["slope_pct"]) <= float(crop["max_slope_pct"])
                and float(grid["soil_depth_cm"]) >= float(crop["min_soil_depth_cm"])
                and float(grid["annual_rainfall_mm"])
                >= float(crop["min_annual_rainfall"])
            )

            if not is_viable:
                suitability_label = "N"
            else:
                matched_conditions = (
                    float(crop["ideal_ph_min"])
                    <= float(grid["soil_ph"])
                    <= float(crop["ideal_ph_max"]),
                    is_within_range(
                        grid["elevation_meters"],
                        crop_ranges.get("elevation_meters"),
                    ),
                    is_within_range(
                        grid["annual_rainfall_mm"],
                        crop_ranges.get("annual_rainfall_mm"),
                    ),
                    is_within_range(
                        grid["solar_radiation"],
                        crop_ranges.get("solar_radiation"),
                    ),
                    is_within_range(
                        grid["root_zone_moisture"],
                        crop_ranges.get("root_zone_moisture"),
                    ),
                )
                match_ratio = sum(matched_conditions) / len(matched_conditions)
                if match_ratio >= S1_MIN_MATCH_RATIO:
                    suitability_label = "S1"
                elif match_ratio >= S2_MIN_MATCH_RATIO:
                    suitability_label = "S2"
                else:
                    suitability_label = "S3"

            training_samples.append(
                {
                    "grid_id": int(grid["id"]),
                    "district_key": _district_key(grid["district"]),
                    "data_split": (
                        "train" if int(grid["id"]) in train_grid_ids else "test"
                    ),
                    "crop_name": crop_name,
                    **{
                        field_name: float(grid[field_name])
                        for field_name in REQUIRED_ENVIRONMENT_FIELDS
                    },
                    "suitability_class": suitability_label,
                }
            )
    return pd.DataFrame(training_samples)


def generate_biophysical_labels_from_db(
    *,
    include_registry: bool = False,
    include_training_context: bool = False,
):
    """Build data-driven labels and optionally return the validation registry."""

    if include_training_context and not include_registry:
        raise ValueError("Training context requires include_registry=True.")

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    crops, grids, statistics = _load_training_source(engine)
    if not crops or not grids:
        if include_training_context:
            return None, [], {}
        return (None, []) if include_registry else None

    registry, crop_statistics_rows, complete_grids = _build_registry(
        crops,
        grids,
        statistics,
    )
    registry_by_name = {row["crop_name"]: row for row in registry}
    included_crops = [
        crop
        for crop in crops
        if registry_by_name[str(crop["name"]).strip()]["ml_supported"]
    ]
    train_grids, test_grids = _split_environment_grids(complete_grids)
    train_grid_ids = {int(grid["id"]) for grid in train_grids}
    training_frame = _generate_training_samples(
        included_crops,
        complete_grids,
        crop_statistics_rows,
        range_grids=train_grids,
        train_grid_ids=train_grid_ids,
    )

    if not training_frame.empty:
        for crop_name, crop_frame in training_frame.groupby("crop_name"):
            class_distribution = {
                label: int((crop_frame["suitability_class"] == label).sum())
                for label in MODEL_CLASS_ORDER
            }
            registry_row = registry_by_name[crop_name]
            registry_row["generated_training_samples"] = len(crop_frame)
            registry_row["class_distribution"] = class_distribution
            train_class_distribution = Counter(
                crop_frame[crop_frame["data_split"] == "train"]["suitability_class"]
            )
            distinct_classes = sum(
                train_class_distribution.get(label, 0) > 0
                for label in MODEL_CLASS_ORDER
            )
            if distinct_classes < MIN_DISTINCT_SUITABILITY_CLASSES:
                registry_row["ml_supported"] = False
                registry_row["exclusion_reasons"].append(
                    "Outer-training labels contain only "
                    f"{distinct_classes} suitability class; at least "
                    f"{MIN_DISTINCT_SUITABILITY_CLASSES} are required."
                )

        removed_names = {
            row["crop_name"] for row in registry if not row["ml_supported"]
        }
        if removed_names:
            training_frame = training_frame[
                ~training_frame["crop_name"].isin(removed_names)
            ].reset_index(drop=True)

    if include_training_context:
        supported_crop_names = (
            set(training_frame["crop_name"])
            if "crop_name" in training_frame.columns
            else set()
        )
        training_context = {
            "crops": [
                crop
                for crop in included_crops
                if str(crop["name"]).strip() in supported_crop_names
            ],
            "crop_statistics_rows": crop_statistics_rows,
            "outer_train_grids": train_grids,
            "outer_test_grids": test_grids,
        }
        return training_frame, registry, training_context
    return (training_frame, registry) if include_registry else training_frame


def _build_metrics(
    classifier,
    test_frame: pd.DataFrame,
    y_test: pd.Series,
    y_pred,
    train_size: int,
    train_districts: set,
    test_districts: set,
) -> tuple[dict, list[dict], pd.DataFrame]:
    labels = [label for label in MODEL_CLASS_ORDER if label in classifier.classes_]
    report = classification_report(
        y_test,
        y_pred,
        labels=labels,
        output_dict=True,
        zero_division=0,
    )
    matrix = confusion_matrix(y_test, y_pred, labels=labels)
    matrix_frame = pd.DataFrame(
        matrix,
        index=[f"actual_{label}" for label in labels],
        columns=[f"predicted_{label}" for label in labels],
    )

    evaluated = test_frame[["crop_name", "suitability_class"]].copy()
    evaluated["predicted_class"] = y_pred
    per_crop_metrics = []
    for crop_name, crop_frame in evaluated.groupby("crop_name", sort=True):
        crop_report = classification_report(
            crop_frame["suitability_class"],
            crop_frame["predicted_class"],
            labels=labels,
            output_dict=True,
            zero_division=0,
        )
        per_crop_metrics.append(
            {
                "crop_name": crop_name,
                "test_samples": len(crop_frame),
                "accuracy": accuracy_score(
                    crop_frame["suitability_class"],
                    crop_frame["predicted_class"],
                ),
                "macro_precision": crop_report["macro avg"]["precision"],
                "macro_recall": crop_report["macro avg"]["recall"],
                "macro_f1": crop_report["macro avg"]["f1-score"],
            }
        )

    class_distribution = Counter(test_frame["suitability_class"])
    full_distribution = Counter(
        list(test_frame["suitability_class"])
    )
    non_zero_counts = [count for count in full_distribution.values() if count]
    metrics = {
        "overall_accuracy": accuracy_score(y_test, y_pred),
        "precision_recall_f1": report,
        "confusion_matrix_labels": labels,
        "confusion_matrix": matrix.tolist(),
        "test_class_distribution": {
            label: int(class_distribution.get(label, 0)) for label in MODEL_CLASS_ORDER
        },
        "train_samples": int(train_size),
        "test_samples": int(len(test_frame)),
        "train_district_groups": len(train_districts),
        "test_district_groups": len(test_districts),
        "district_group_overlap": len(train_districts & test_districts),
        "test_imbalance_ratio": (
            max(non_zero_counts) / min(non_zero_counts) if non_zero_counts else None
        ),
    }
    return metrics, per_crop_metrics, matrix_frame


def _write_reports(
    registry: list[dict],
    metadata: dict,
    per_crop_metrics: list[dict],
    matrix_frame: pd.DataFrame,
) -> None:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)

    registry_frame = pd.DataFrame(registry)
    registry_frame["exclusion_reasons"] = registry_frame["exclusion_reasons"].apply(
        lambda reasons: " | ".join(reasons)
    )
    registry_frame["class_distribution"] = registry_frame["class_distribution"].apply(
        json.dumps
    )
    registry_frame.to_csv(INTEGRITY_REPORT_PATH, index=False)
    pd.DataFrame(per_crop_metrics).to_csv(PER_CROP_METRICS_PATH, index=False)
    matrix_frame.to_csv(CONFUSION_MATRIX_PATH)

    for output_path in (MODEL_METADATA_PATH, TRAINING_REPORT_PATH):
        with output_path.open("w", encoding="utf-8") as output_file:
            json.dump(metadata, output_file, indent=2, ensure_ascii=False)
            output_file.write("\n")


def _build_encoded_feature_frame(
    frame: pd.DataFrame,
    encoder: OneHotEncoder,
) -> pd.DataFrame:
    # Preserve this column order in prediction_service.build_model_input_frame.
    # Trees need no scaling; one-hot crop identity avoids an artificial ordering.
    crop_feature_names = list(encoder.get_feature_names_out(["crop_name"]))
    encoded_crops = pd.DataFrame(
        encoder.transform(frame[["crop_name"]]),
        columns=crop_feature_names,
        index=frame.index,
    )
    return pd.concat(
        [encoded_crops, frame[list(MODEL_ENVIRONMENT_FIELDS)]],
        axis=1,
    )


def _new_crop_encoder() -> OneHotEncoder:
    return OneHotEncoder(
        handle_unknown="error",
        sparse_output=False,
        dtype="float64",
    )


def _new_classifier(parameters: dict) -> RandomForestClassifier:
    return RandomForestClassifier(
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
        **parameters,
    )


def _class_distribution(frame: pd.DataFrame) -> dict[str, int]:
    counts = Counter(frame["suitability_class"])
    return {
        label: int(counts.get(label, 0))
        for label in MODEL_CLASS_ORDER
    }


def _select_model_parameters_with_fold_local_ranges(
    crops: list[dict],
    outer_train_grids: list[dict],
    crop_statistics_rows: dict[str, list[dict]],
) -> dict:
    """Select RF parameters without letting validation grids define their labels."""

    grid_frame = pd.DataFrame(
        {
            "grid_id": [int(grid["id"]) for grid in outer_train_grids],
            "district_key": [
                _district_key(grid["district"])
                for grid in outer_train_grids
            ],
        }
    )
    split_definitions = []
    splitter = GroupKFold(n_splits=3)
    for fold_number, (fit_indices, validation_indices) in enumerate(
        splitter.split(grid_frame, groups=grid_frame["district_key"]),
        start=1,
    ):
        fit_grid_ids = set(
            grid_frame.iloc[fit_indices]["grid_id"].astype(int)
        )
        validation_grid_ids = set(
            grid_frame.iloc[validation_indices]["grid_id"].astype(int)
        )
        fit_grids = [
            grid
            for grid in outer_train_grids
            if int(grid["id"]) in fit_grid_ids
        ]
        fit_districts = {
            _district_key(grid["district"])
            for grid in fit_grids
        }
        validation_districts = {
            _district_key(grid["district"])
            for grid in outer_train_grids
            if int(grid["id"]) in validation_grid_ids
        }
        if fit_grid_ids & validation_grid_ids or fit_districts & validation_districts:
            raise RuntimeError(f"Fold {fold_number} has overlapping fit/validation data.")
        split_definitions.append(
            {
                "fold": fold_number,
                "fit_grid_ids": fit_grid_ids,
                "validation_grid_ids": validation_grid_ids,
                "fit_grids": fit_grids,
                "fit_districts": fit_districts,
                "validation_districts": validation_districts,
            }
        )

    candidate_results = []
    fold_details = []
    for candidate_order, parameters in enumerate(MODEL_PARAMETER_CANDIDATES, start=1):
        fold_scores = []
        fold_train_scores = []
        fold_train_accuracies = []
        fold_validation_accuracies = []
        for split_definition in split_definitions:
            # Regenerate both sides for every candidate/fold. Productive ranges
            # are fitted solely on the fold-fit grids, never validation grids.
            fold_frame = _generate_training_samples(
                crops,
                outer_train_grids,
                crop_statistics_rows,
                range_grids=split_definition["fit_grids"],
                train_grid_ids=split_definition["fit_grid_ids"],
            )
            fit_frame = fold_frame[fold_frame["data_split"] == "train"].copy()
            validation_frame = fold_frame[
                fold_frame["data_split"] == "test"
            ].copy()

            fold_encoder = _new_crop_encoder()
            fold_encoder.fit(fit_frame[["crop_name"]])
            fit_features = _build_encoded_feature_frame(fit_frame, fold_encoder)
            validation_features = _build_encoded_feature_frame(
                validation_frame,
                fold_encoder,
            )
            fold_classifier = _new_classifier(parameters)
            fold_classifier.fit(
                fit_features,
                fit_frame["suitability_class"],
            )
            fold_predictions = fold_classifier.predict(validation_features)
            fit_predictions = fold_classifier.predict(fit_features)
            fold_train_scores.append(float(f1_score(
                fit_frame["suitability_class"], fit_predictions,
                labels=MODEL_CLASS_ORDER, average="macro", zero_division=0,
            )))
            fold_train_accuracies.append(float(accuracy_score(fit_frame["suitability_class"], fit_predictions)))
            fold_validation_accuracies.append(float(accuracy_score(validation_frame["suitability_class"], fold_predictions)))
            fold_score = float(
                f1_score(
                    validation_frame["suitability_class"],
                    fold_predictions,
                    average="macro",
                    zero_division=0,
                )
            )
            if not math.isfinite(fold_score):
                raise RuntimeError(
                    "Non-finite validation score for candidate "
                    f"{candidate_order}, fold {split_definition['fold']}."
                )
            fold_scores.append(fold_score)

            if candidate_order == 1:
                fold_details.append(
                    {
                        "fold": split_definition["fold"],
                        "fit_districts": sorted(split_definition["fit_districts"]),
                        "validation_districts": sorted(
                            split_definition["validation_districts"]
                        ),
                        "fit_grid_samples": len(split_definition["fit_grid_ids"]),
                        "validation_grid_samples": len(
                            split_definition["validation_grid_ids"]
                        ),
                        "fit_generated_samples": len(fit_frame),
                        "validation_generated_samples": len(validation_frame),
                        "fit_class_distribution": _class_distribution(fit_frame),
                        "validation_class_distribution": _class_distribution(
                            validation_frame
                        ),
                        "district_group_overlap": len(
                            split_definition["fit_districts"]
                            & split_definition["validation_districts"]
                        ),
                        "grid_id_overlap": len(
                            split_definition["fit_grid_ids"]
                            & split_definition["validation_grid_ids"]
                        ),
                        "productive_environment_ranges_fit_on_fold_fit_districts_only": True,
                    }
                )

        score_series = pd.Series(fold_scores, dtype="float64")
        candidate_results.append(
            {
                "candidate_order": candidate_order,
                "parameters": dict(parameters),
                "fold_validation_scores": fold_scores,
                "mean_validation_score": float(score_series.mean()),
                "standard_deviation": float(score_series.std(ddof=0)),
                "fold_train_macro_f1": fold_train_scores,
                "mean_train_macro_f1": float(pd.Series(fold_train_scores).mean()),
                "fold_train_accuracy": fold_train_accuracies,
                "fold_validation_accuracy": fold_validation_accuracies,
                "mean_validation_accuracy": float(pd.Series(fold_validation_accuracies).mean()),
                "validation_accuracy_standard_deviation": float(pd.Series(fold_validation_accuracies).std(ddof=0)),
            }
        )

    best_candidate = max(
        candidate_results,
        key=lambda result: (
            result["mean_validation_score"],
            -result["candidate_order"],
        ),
    )
    return {
        "method": (
            "3-fold GroupKFold on outer-training districts with fold-local "
            "productive-range and label regeneration"
        ),
        "scoring": "macro F1",
        "best_cross_validation_score": best_candidate["mean_validation_score"],
        "best_cross_validation_standard_deviation": best_candidate["standard_deviation"],
        "best_parameters": dict(best_candidate["parameters"]),
        "n_splits": len(split_definitions),
        "candidate_count": len(candidate_results),
        "evaluated_model_fits": len(split_definitions) * len(candidate_results),
        "cross_validation_fold_ranges_refit": True,
        "cross_validation_labels_regenerated_per_candidate_fold": True,
        "selection_tie_breaker": (
            "Highest mean validation macro F1; earliest declared candidate wins exact ties."
        ),
        "folds": fold_details,
        "candidates": candidate_results,
    }


def execute_training_pipeline() -> dict | None:
    print("=" * 72)
    print("AGROW DATA-DRIVEN CROP SUITABILITY TRAINING")
    print("=" * 72)
    training_frame, registry, training_context = generate_biophysical_labels_from_db(
        include_registry=True,
        include_training_context=True,
    )
    if training_frame is None or training_frame.empty:
        print("Training cancelled: no crop passed the data-integrity checks.")
        return None

    train_frame = training_frame[training_frame["data_split"] == "train"].copy()
    test_frame = training_frame[training_frame["data_split"] == "test"].copy()
    train_districts = set(train_frame["district_key"])
    test_districts = set(test_frame["district_key"])
    train_grid_ids = set(train_frame["grid_id"])
    test_grid_ids = set(test_frame["grid_id"])
    encoder = _new_crop_encoder()
    encoder.fit(train_frame[["crop_name"]])
    trained_crop_names = [str(name) for name in encoder.categories_[0]]
    train_features = _build_encoded_feature_frame(train_frame, encoder)
    test_features = _build_encoded_feature_frame(test_frame, encoder)
    model_feature_fields = tuple(train_features.columns)

    model_selection = _select_model_parameters_with_fold_local_ranges(
        training_context["crops"],
        training_context["outer_train_grids"],
        training_context["crop_statistics_rows"],
    )
    classifier = _new_classifier(model_selection["best_parameters"])
    classifier.fit(
        train_features,
        train_frame["suitability_class"],
    )
    predictions = classifier.predict(test_features)
    # Report resubstitution performance alongside held-out metrics; high test
    # accuracy alone cannot reveal memorization of the small grid population.
    train_predictions = classifier.predict(train_features)
    metrics, per_crop_metrics, matrix_frame = _build_metrics(
        classifier,
        test_frame,
        test_frame["suitability_class"],
        predictions,
        len(train_frame),
        train_districts,
        test_districts,
    )
    metrics["training_accuracy"] = float(accuracy_score(train_frame["suitability_class"], train_predictions))
    metrics["training_precision_recall_f1"] = classification_report(
        train_frame["suitability_class"], train_predictions,
        labels=MODEL_CLASS_ORDER, output_dict=True, zero_division=0,
    )
    metrics["train_test_accuracy_gap"] = metrics["training_accuracy"] - metrics["overall_accuracy"]

    assets_dir = MODEL_METADATA_PATH.parent
    assets_dir.mkdir(parents=True, exist_ok=True)
    model_path = assets_dir / "crop_classifier.joblib"
    encoder_path = assets_dir / "crop_encoder.joblib"
    joblib.dump(classifier, model_path, compress=3)
    joblib.dump(encoder, encoder_path)

    full_class_distribution = Counter(training_frame["suitability_class"])
    non_zero_class_counts = {
        label: int(count)
        for label, count in full_class_distribution.items()
        if count > 0
    }
    majority_class = max(non_zero_class_counts, key=non_zero_class_counts.get)
    minority_class = min(non_zero_class_counts, key=non_zero_class_counts.get)
    imbalance_ratio = (
        non_zero_class_counts[majority_class]
        / non_zero_class_counts[minority_class]
    )
    samples_per_crop = {
        crop_name: int(count)
        for crop_name, count in training_frame.groupby("crop_name").size().items()
    }
    metadata = {
        "schema_version": 1,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_type": "RandomForestClassifier",
        "model_parameters": classifier.get_params(),
        "model_selection": model_selection,
        "feature_fields": list(model_feature_fields),
        "crop_encoding": "one_hot",
        "target_field": "suitability_class",
        "trained_crop_names": trained_crop_names,
        "total_crops": len(trained_crop_names),
        "registry_crop_count": len(registry),
        "statistics_crop_count": sum(
            bool(row.get("statistics_available")) for row in registry
        ),
        "total_training_samples": len(training_frame),
        "samples_per_crop": samples_per_crop,
        "class_distribution": {
            label: int(full_class_distribution.get(label, 0))
            for label in MODEL_CLASS_ORDER
        },
        "class_imbalance": {
            "majority_class": majority_class,
            "minority_class": minority_class,
            "majority_to_minority_ratio": imbalance_ratio,
            "mitigation": "RandomForest class_weight='balanced_subsample'.",
        },
        "split": {
            "method": "grouped 80/20 split by district before label generation",
            "train_samples": len(train_frame),
            "test_samples": len(test_frame),
            "train_district_groups": len(train_districts),
            "test_district_groups": len(test_districts),
            "train_districts": sorted(train_districts),
            "test_districts": sorted(test_districts),
            "train_grid_samples": len(train_grid_ids),
            "test_grid_samples": len(test_grid_ids),
        },
        "eligibility_policy": {
            "minimum_positive_production_records": MIN_PRODUCTIVE_STATISTIC_RECORDS,
            "minimum_positive_production_years": MIN_PRODUCTIVE_YEARS,
            "minimum_productive_grid_districts": MIN_PRODUCTIVE_GRID_DISTRICTS,
            "minimum_complete_environment_samples": MIN_COMPLETE_ENVIRONMENT_SAMPLES,
            "minimum_distinct_suitability_classes": MIN_DISTINCT_SUITABILITY_CLASSES,
            "required_suitability_fields": list(REQUIRED_SUITABILITY_FIELDS),
            "required_environment_fields": list(REQUIRED_ENVIRONMENT_FIELDS),
        },
        "label_generation_policy": {
            "veto_requirements": [
                "maximum crop slope",
                "minimum crop soil depth",
                "minimum crop annual rainfall",
            ],
            "preference_matches": [
                "crop ideal soil-pH range",
                "training-district productive elevation range",
                "training-district productive rainfall range",
                "training-district productive solar-radiation range",
                "training-district productive root-zone-moisture range",
            ],
            "S1_minimum_match_ratio": S1_MIN_MATCH_RATIO,
            "S2_minimum_match_ratio": S2_MIN_MATCH_RATIO,
            "historical_production_as_model_feature": False,
            "temperature_requirements_validated_for_completeness": True,
            "temperature_used_in_ml_labels": False,
            "temperature_used_as_ml_feature": False,
            "temperature_exclusion_reason": (
                "The spatial_grids training source has no temperature field; runtime "
                "temperature_annual raster values are used only by the separate "
                "rule-based suitability score."
            ),
            "note": (
                "Historical production determines crop eligibility and productive "
                "environment ranges, but is not scored directly because it is an "
                "outcome proxy unavailable for a new-site environmental prediction."
            ),
        },
        "leakage_checks": {
            "target_in_feature_fields": "suitability_class" in model_feature_fields,
            "district_group_overlap": len(train_districts & test_districts),
            "grid_id_overlap": len(train_grid_ids & test_grid_ids),
            "empirical_ranges_fit_on_training_districts_only": True,
            "cross_validation_fold_ranges_refit": True,
            "cross_validation_labels_regenerated_per_candidate_fold": True,
            "note": (
                "Labels are generated from generic crop requirements, productive-district "
                "history, and environmental inputs. The target is not a feature; outer "
                "empirical ranges are fitted only on outer-training districts; every "
                "cross-validation fold refits ranges and labels from its fit districts; "
                "and no district or spatial grid id appears in both outer train and test sets."
            ),
        },
        "metrics": metrics,
        "per_crop_metrics": per_crop_metrics,
        "crop_registry": registry,
        "data_provenance_warning": (
            "The current spatial_grids seed process uses API-derived elevation/climate "
            "but randomly generated soil pH, slope, soil depth, and point jitter. Metrics "
            "therefore validate reproducibility of this prototype dataset, not field-level "
            "agronomic accuracy."
        ),
    }
    _write_reports(registry, metadata, per_crop_metrics, matrix_frame)

    print(f"Included crops: {len(trained_crop_names)}")
    print(f"Training samples: {len(training_frame)}")
    print(
        f"Split: {len(train_frame)} train / {len(test_frame)} test "
        f"({len(train_districts)} / {len(test_districts)} districts)"
    )
    print(f"Validation accuracy: {metrics['overall_accuracy'] * 100:.2f}%")
    print("Class distribution:", metadata["class_distribution"])
    print(f"Registry report: {INTEGRITY_REPORT_PATH}")
    print(f"Training report: {TRAINING_REPORT_PATH}")
    print("=" * 72)
    return metadata


if __name__ == "__main__":
    execute_training_pipeline()
