import pytest

from app.api.endpoints.predict import (
    PredictionInput,
    predict_crop_suitability,
)
from app.services.prediction_service import (
    PredictionModelInputError,
    build_model_feature_values,
    build_model_suitability,
    model_class_to_score,
    predict_suitability_with_model,
)


LEGACY_MODEL_VALUES = {
    "elevation_meters": 450.0,
    "slope_pct": 6.5,
    "soil_ph": 6.2,
    "soil_depth_cm": 110,
    "annual_rainfall_mm": 2100.0,
    "solar_radiation": 16.5,
    "root_zone_moisture": 0.42,
}


def test_legacy_endpoint_and_shared_model_return_identical_results():
    shared_result = predict_suitability_with_model(
        "Durian",
        LEGACY_MODEL_VALUES,
    )
    legacy_result = predict_crop_suitability(
        PredictionInput(
            crop_name="Durian",
            latitude=5.98,
            longitude=116.08,
            district="Ranau",
            **LEGACY_MODEL_VALUES,
        )
    )

    assert legacy_result["suitability"] == shared_result["suitability_class"]
    assert legacy_result["confidence_matrix"] == shared_result["confidence_matrix"]
    assert list(legacy_result["confidence_matrix"]) == ["S1", "S2", "S3", "N"]
    assert sum(legacy_result["confidence_matrix"].values()) == pytest.approx(
        100,
        abs=0.05,
    )


def test_prediction_page_environment_aliases_use_the_same_model_features():
    legacy_result = predict_suitability_with_model(
        "Watermelon",
        LEGACY_MODEL_VALUES,
    )
    prediction_page_result = predict_suitability_with_model(
        "Watermelon",
        {
            "elevation_m": LEGACY_MODEL_VALUES["elevation_meters"],
            "slope_pct": LEGACY_MODEL_VALUES["slope_pct"],
            "soil_ph": LEGACY_MODEL_VALUES["soil_ph"],
            "soil_depth_cm": LEGACY_MODEL_VALUES["soil_depth_cm"],
            "rainfall_mm": LEGACY_MODEL_VALUES["annual_rainfall_mm"],
            "solar_radiation": LEGACY_MODEL_VALUES["solar_radiation"],
            "root_zone_moisture": LEGACY_MODEL_VALUES[
                "root_zone_moisture"
            ],
        },
    )

    assert prediction_page_result == legacy_result


def test_prediction_page_values_use_legacy_live_matrix_precision():
    values = build_model_feature_values(
        {
            "elevation_m": 123.456,
            "slope_pct": 4.567,
            "soil_ph": 6.249,
            "soil_depth_cm": 87.6,
            "rainfall_mm": 1987.654,
            "solar_radiation": 15.678,
            "root_zone_moisture": 0.4567,
        }
    )

    assert values == {
        "elevation_meters": 123.5,
        "slope_pct": 4.6,
        "soil_ph": 6.2,
        "soil_depth_cm": 88.0,
        "annual_rainfall_mm": 1987.7,
        "solar_radiation": 15.68,
        "root_zone_moisture": 0.46,
    }

    assert build_model_feature_values({"soil_ph": 6.25})["soil_ph"] == 6.3


def test_model_class_is_authoritative_in_rich_suitability_response():
    diagnostics = {
        "score": 12,
        "status": "Low suitability",
        "strengths": ["Diagnostic strength"],
        "limitations": ["Diagnostic limitation"],
        "recommendations": ["Diagnostic recommendation"],
        "risk_level": "High",
        "risk_warnings": ["Diagnostic limitation"],
        "confidence": "Legacy diagnostic confidence",
    }
    model_prediction = {
        "suitability_class": "S1",
        "confidence_matrix": {
            "S1": 82.0,
            "S2": 10.0,
            "S3": 5.0,
            "N": 3.0,
        },
        "model_confidence_pct": 82.0,
    }

    result = build_model_suitability(
        diagnostics,
        model_prediction,
        sample_count=5,
    )

    assert result["classification"] == "S1"
    assert result["status"] == "Highly suitable"
    assert 80 <= result["score"] <= 100
    assert result["confidence_matrix"] == model_prediction["confidence_matrix"]
    assert result["strengths"] == diagnostics["strengths"]
    assert result["recommendations"] == diagnostics["recommendations"]


@pytest.mark.parametrize(
    ("suitability_class", "confidence", "expected_score"),
    [
        ("S1", 100, 100),
        ("S2", 100, 79),
        ("S3", 100, 59),
        ("N", 100, 0),
    ],
)
def test_model_score_stays_inside_its_class_band(
    suitability_class,
    confidence,
    expected_score,
):
    assert model_class_to_score(
        suitability_class,
        confidence,
    ) == expected_score


def test_shared_model_rejects_unsupported_crop():
    with pytest.raises(PredictionModelInputError):
        predict_suitability_with_model(
            "Banana",
            LEGACY_MODEL_VALUES,
        )
