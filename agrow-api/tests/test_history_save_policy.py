import unittest
from types import SimpleNamespace

from app.services.history_service import history_save_block_reason


def payload(*, forest=None, land_cover=None, prediction=None):
    return SimpleNamespace(
        forest_reserve_result=forest,
        land_cover_result=land_cover,
        prediction_result=prediction or {},
    )


class HistorySavePolicyTests(unittest.TestCase):
    def test_allows_ordinary_agricultural_area(self):
        reason = history_save_block_reason(
            payload(
                forest={"allowed": True, "reserved_forest": False},
                land_cover={"land_cover": "cropland"},
            )
        )

        self.assertIsNone(reason)

    def test_blocks_forest_reserve(self):
        reason = history_save_block_reason(
            payload(forest={"allowed": False, "reserved_forest": True})
        )

        self.assertIn("forest reserve", reason)

    def test_blocks_visible_building_even_when_not_materially_built_up(self):
        reason = history_save_block_reason(
            payload(
                land_cover={
                    "land_cover": "cropland",
                    "satellite_building_analysis": {
                        "buildings_detected": True,
                        "is_built_up": False,
                    },
                }
            )
        )

        self.assertIn("building", reason)

    def test_blocks_built_up_land_cover_without_satellite_result(self):
        reason = history_save_block_reason(
            payload(land_cover={"land_cover": "built-up"})
        )

        self.assertIn("built-up", reason)


if __name__ == "__main__":
    unittest.main()
