import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
from pydantic import ValidationError
from sklearn.preprocessing import OneHotEncoder

from app.api.endpoints.predict import BatchPredictionInput
from app.services import crop_registry
from app.services.prediction_service import (
    PredictionModelError,
    PredictionModelInputError,
    predict_suitability_batch_with_model,
    predict_suitability_with_model,
)


MODEL_VALUES = {
    "elevation_meters": 100,
    "slope_pct": 5,
    "soil_ph": 6.2,
    "soil_depth_cm": 80,
    "annual_rainfall_mm": 2000,
    "solar_radiation": 16.5,
    "root_zone_moisture": 0.5,
}


class CropRegistryTests(unittest.TestCase):
    def test_matches_unique_punctuation_variant_without_crop_specific_aliases(self):
        matches, unmatched = crop_registry.match_crop_names(
            ["Watercress", "Banana"],
            ["Water-Cress", "banana"],
        )

        self.assertEqual(matches["Watercress"], "Water-Cress")
        self.assertEqual(matches["Banana"], "banana")
        self.assertEqual(unmatched, {})

    def test_does_not_guess_when_compact_name_is_ambiguous(self):
        matches, unmatched = crop_registry.match_crop_names(
            ["Foo-Bar", "Foo Bar"],
            ["Foobar"],
        )

        self.assertEqual(matches, {})
        self.assertEqual(set(unmatched), {"Foo-Bar", "Foo Bar"})

    @patch("app.services.crop_registry.load_model_metadata")
    def test_discovers_and_canonicalizes_crops_from_metadata(self, metadata):
        metadata.return_value = {
            "trained_crop_names": [" Banana ", "Durian", ""],
        }

        self.assertEqual(
            crop_registry.get_trained_crop_names(),
            ("Banana", "Durian"),
        )
        self.assertEqual(
            crop_registry.canonical_trained_crop_name("  bANana "),
            "Banana",
        )

    @patch("app.services.crop_registry.joblib.load")
    @patch("app.services.crop_registry.load_model_metadata", return_value={})
    def test_falls_back_to_legacy_encoder_when_metadata_is_absent(
        self,
        _metadata,
        load,
    ):
        load.return_value = SimpleNamespace(classes_=["Cabbage", "Durian"])

        self.assertEqual(
            crop_registry.get_trained_crop_names(),
            ("Cabbage", "Durian"),
        )


class _FakeEncoder:
    def __init__(self, mapping):
        self.mapping = mapping

    def transform(self, names):
        try:
            return [self.mapping[name] for name in names]
        except KeyError as exc:
            raise ValueError("unknown crop") from exc


class _FakeClassifier:
    classes_ = ["N", "S1", "S2", "S3"]

    def __init__(self):
        self.prediction_frame = None

    def predict(self, frame):
        self.prediction_frame = frame.copy()
        return ["S1", "S2"]

    def predict_proba(self, _frame):
        return [
            [0.05, 0.8, 0.1, 0.05],
            [0.1, 0.2, 0.6, 0.1],
        ]


class BatchPredictionTests(unittest.TestCase):
    @patch("app.services.prediction_service.load_prediction_model")
    @patch("app.services.prediction_service.canonical_prediction_crop_name")
    def test_batch_builds_one_hot_crop_features_for_current_model(
        self,
        canonical,
        load_model,
    ):
        canonical.side_effect = lambda name: str(name).strip().title()
        encoder = OneHotEncoder(handle_unknown="error", sparse_output=False)
        encoder.fit(pd.DataFrame({"crop_name": ["Banana", "Durian"]}))
        classifier = _FakeClassifier()
        load_model.return_value = (classifier, encoder)

        results, errors = predict_suitability_batch_with_model(
            ["Banana", "Durian"],
            MODEL_VALUES,
        )

        self.assertEqual(len(results), 2)
        self.assertEqual(errors, [])
        self.assertEqual(
            classifier.prediction_frame[
                ["crop_name_Banana", "crop_name_Durian"]
            ].values.tolist(),
            [[1.0, 0.0], [0.0, 1.0]],
        )
        self.assertEqual(
            classifier.prediction_frame["soil_ph"].tolist(),
            [MODEL_VALUES["soil_ph"], MODEL_VALUES["soil_ph"]],
        )

    @patch("app.services.prediction_service.load_prediction_model")
    @patch("app.services.prediction_service.canonical_prediction_crop_name")
    def test_batch_deduplicates_canonical_crops_and_keeps_item_errors(
        self,
        canonical,
        load_model,
    ):
        canonical.side_effect = lambda name: {
            "banana": "Banana",
            "BANANA": "Banana",
            "Durian": "Durian",
        }.get(str(name).strip())
        classifier = _FakeClassifier()
        load_model.return_value = (
            classifier,
            _FakeEncoder({"Banana": 0, "Durian": 1}),
        )

        results, errors = predict_suitability_batch_with_model(
            [" banana ", "Unknown", "BANANA", "Durian"],
            MODEL_VALUES,
        )

        self.assertEqual([result["crop"] for result in results], ["Banana", "Durian"])
        self.assertEqual(results[0]["suitability"], "S1")
        self.assertEqual(results[0]["model_confidence_pct"], 80.0)
        self.assertEqual(errors[0]["crop"], "Unknown")
        self.assertEqual(
            classifier.prediction_frame["crop_encoded"].tolist(),
            [0, 1],
        )

    @patch("app.services.prediction_service.load_prediction_model")
    @patch("app.services.prediction_service.get_trained_crop_names", return_value=())
    def test_batch_reports_missing_registry_as_server_error(
        self,
        _trained_names,
        load_model,
    ):
        with self.assertRaises(PredictionModelError):
            predict_suitability_batch_with_model(None, MODEL_VALUES)
        load_model.assert_not_called()

    def test_batch_rejects_an_explicit_empty_crop_list(self):
        with self.assertRaises(PredictionModelInputError):
            predict_suitability_batch_with_model([], MODEL_VALUES)

        with self.assertRaises(ValidationError):
            BatchPredictionInput(
                crop_names=[],
                latitude=5,
                longitude=116,
                **MODEL_VALUES,
            )

    @patch("app.services.prediction_service.load_prediction_model")
    @patch(
        "app.services.prediction_service.canonical_prediction_crop_name",
        return_value="Banana",
    )
    def test_single_prediction_treats_encoder_registry_mismatch_as_server_error(
        self,
        _canonical,
        load_model,
    ):
        classifier = Mock()
        load_model.return_value = (classifier, _FakeEncoder({}))

        with self.assertRaises(PredictionModelError):
            predict_suitability_with_model("Banana", MODEL_VALUES)
        classifier.predict.assert_not_called()


if __name__ == "__main__":
    unittest.main()
