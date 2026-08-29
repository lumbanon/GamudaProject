import base64
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests

from app.services.gemini_insight_service import build_gemini_ai_insight
from app.services.prediction_service import apply_satellite_land_cover_analysis
from app.services.satellite_vision_service import (
    decode_image_data_url,
    normalize_satellite_analysis,
)


VALID_PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(
    b"\x89PNG\r\n\x1a\nminimal-test-image"
).decode("ascii")


class SatelliteVisionServiceTests(unittest.TestCase):
    def build_combined_insight(self, image_data_url=VALID_PNG_DATA_URL):
        return build_gemini_ai_insight(
            crop=SimpleNamespace(name="Durian", scientific_name="Durio zibethinus"),
            district="Test District",
            area_hectares=2.5,
            environment={
                "sample_count": 10,
                "values": {"land_cover": "cropland", "missing_fields": []},
            },
            suitability={
                "score": 80,
                "status": "Suitable",
                "strengths": ["Rainfall is adequate."],
                "limitations": [],
                "risk_warnings": [],
                "recommendations": ["Inspect the site before planting."],
                "confidence": "High",
            },
            recommendations=["Inspect the site before planting."],
            planting_window={"best_months": ["October"], "reason": "Suitable rainfall."},
            return_estimate={"estimated_revenue_myr": 1000},
            satellite_image_data_url=image_data_url,
            fallback="Fallback summary.",
        )

    def test_decodes_supported_image_data_url(self):
        mime_type, encoded, size = decode_image_data_url(VALID_PNG_DATA_URL)

        self.assertEqual(mime_type, "image/png")
        self.assertTrue(encoded)
        self.assertGreater(size, 8)

    def test_rejects_invalid_image_data(self):
        with self.assertRaises(ValueError):
            decode_image_data_url("data:image/png;base64,invalid")

    def test_recommends_override_only_for_confident_usable_built_up_result(self):
        result = normalize_satellite_analysis(
            {
                "buildings_detected": True,
                "is_built_up": True,
                "estimated_built_up_percent": 70,
                "confidence": "high",
                "image_quality": "usable",
                "explanation": "Dense rooftops and paved compounds are visible.",
            },
            model="test-model",
            image_size=100,
        )

        self.assertTrue(result["land_cover_override_recommended"])

    def test_weak_negative_result_is_inconclusive(self):
        result = normalize_satellite_analysis(
            {
                "buildings_detected": False,
                "is_built_up": False,
                "estimated_built_up_percent": 0,
                "confidence": "low",
                "image_quality": "limited",
                "explanation": "The image is too blurry to exclude small roofs.",
            },
            model="test-model",
            image_size=100,
        )

        self.assertIsNone(result["buildings_detected"])
        self.assertIsNone(result["is_built_up"])
        self.assertFalse(result["land_cover_override_recommended"])

    def test_applies_override_without_losing_raster_provenance(self):
        values = {
            "land_cover": "cropland",
            "missing_fields": [],
            "overridden_fields": [],
        }
        apply_satellite_land_cover_analysis(
            values,
            {"status": "analyzed", "land_cover_override_recommended": True},
        )

        self.assertEqual(values["land_cover"], "built-up")
        self.assertEqual(values["raster_land_cover"], "cropland")
        self.assertEqual(values["land_cover_source"], "gemini_satellite_vision")

    @patch("app.services.gemini_insight_service.get_gemini_api_key", return_value="test-key")
    @patch("requests.post")
    def test_negative_multimodal_result_gets_focused_verification(self, post, _get_api_key):
        combined_response = Mock()
        combined_response.raise_for_status.return_value = None
        combined_response.json.return_value = {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "crop_suitability_summary": "The selected site has usable growing conditions.",
                                        "key_strengths": ["Rainfall is adequate."],
                                        "potential_risks": ["Confirm conditions in the field."],
                                        "recommended_actions": ["Inspect the site before planting."],
                                        "confidence_level": "High",
                                        "missing_data": ["No major missing data was flagged in the current analysis."],
                                        "satellite_building_analysis": {
                                            "buildings_detected": False,
                                            "is_built_up": False,
                                            "estimated_built_up_percent": 0,
                                            "confidence": "high",
                                            "image_quality": "usable",
                                            "explanation": "No visible rooftops are present.",
                                        },
                                    }
                                )
                            }
                        ]
                    },
                }
            ]
        }
        verification_response = Mock()
        verification_response.raise_for_status.return_value = None
        verification_response.json.return_value = {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "buildings_detected": False,
                                        "is_built_up": False,
                                        "estimated_built_up_percent": 0,
                                        "confidence": "high",
                                        "image_quality": "usable",
                                        "explanation": "A focused scan found no visible rooftops.",
                                    }
                                )
                            }
                        ]
                    },
                }
            ]
        }
        post.side_effect = [combined_response, verification_response]

        insight, result = self.build_combined_insight()

        self.assertEqual(post.call_count, 2)
        request_json = post.call_args_list[0].kwargs["json"]
        self.assertIn("inline_data", request_json["contents"][0]["parts"][0])
        self.assertIn(
            "satellite_building_analysis",
            request_json["generationConfig"]["responseSchema"]["properties"],
        )
        self.assertEqual(insight["source"], "gemini")
        self.assertEqual(result["status"], "analyzed")
        self.assertFalse(result["buildings_detected"])
        self.assertFalse(result["land_cover_override_recommended"])

        verification_json = post.call_args_list[1].kwargs["json"]
        verification_schema = verification_json["generationConfig"]["responseSchema"]
        self.assertEqual(verification_schema["type"], "OBJECT")
        self.assertIn("buildings_detected", verification_schema["required"])

    @patch("app.services.gemini_insight_service.get_gemini_api_key", return_value="test-key")
    @patch("requests.post")
    def test_focused_verification_can_find_a_missed_building(self, post, _get_api_key):
        combined_response = Mock()
        combined_response.raise_for_status.return_value = None
        combined_response.json.return_value = {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "crop_suitability_summary": "The selected site has usable growing conditions.",
                                        "key_strengths": ["Rainfall is adequate."],
                                        "potential_risks": ["Confirm conditions in the field."],
                                        "recommended_actions": ["Inspect the site before planting."],
                                        "confidence_level": "High",
                                        "missing_data": ["No major missing data was flagged in the current analysis."],
                                        "satellite_building_analysis": {
                                            "buildings_detected": False,
                                            "is_built_up": False,
                                            "estimated_built_up_percent": 0,
                                            "confidence": "medium",
                                            "image_quality": "usable",
                                            "explanation": "No roof was identified in the broad analysis.",
                                        },
                                    }
                                )
                            }
                        ]
                    },
                }
            ]
        }
        verification_response = Mock()
        verification_response.raise_for_status.return_value = None
        verification_response.json.return_value = {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "buildings_detected": True,
                                        "is_built_up": True,
                                        "estimated_built_up_percent": 40,
                                        "confidence": "high",
                                        "image_quality": "usable",
                                        "explanation": "Several rectangular roofs are visible near the eastern edge.",
                                    }
                                )
                            }
                        ]
                    },
                }
            ]
        }
        post.side_effect = [combined_response, verification_response]

        _insight, result = self.build_combined_insight()

        self.assertTrue(result["buildings_detected"])
        self.assertTrue(result["land_cover_override_recommended"])

    @patch("app.services.gemini_insight_service.get_gemini_api_key", return_value="test-key")
    @patch("requests.post")
    def test_429_uses_one_call_and_shared_fallback_reason(self, post, _get_api_key):
        response = Mock(status_code=429)
        post.return_value = response
        response.raise_for_status.side_effect = requests.HTTPError(response=response)

        insight, result = self.build_combined_insight()

        self.assertEqual(post.call_count, 1)
        self.assertTrue(insight["fallback_used"])
        self.assertEqual(
            insight["fallback_reason"],
            "Gemini quota is exhausted. Try again after the quota resets or increase the API quota.",
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["failure_reason"], insight["fallback_reason"])

    @patch("app.services.gemini_insight_service.get_gemini_api_key", return_value=None)
    @patch("requests.post")
    def test_missing_key_makes_no_external_call(self, post, _get_api_key):
        insight, result = self.build_combined_insight()

        post.assert_not_called()
        self.assertTrue(insight["fallback_used"])
        self.assertEqual(result["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
