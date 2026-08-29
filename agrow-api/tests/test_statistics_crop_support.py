import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database.session import Base
from app.models.crop_statistic import CropStatistic
from app.schemas.history import HistoryCreate
from app.schemas.statistics import StatisticsOptionsResponse
from app.services.history_service import history_save_block_reason
from app.services.statistics_service import (
    get_crop_statistics,
    get_statistics_options,
    validate_statistics_filters,
)


class StatisticsCropSupportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            self.engine,
            tables=[CropStatistic.__table__],
        )
        self.db = Session(bind=self.engine)
        self.db.add_all(
            [
                CropStatistic(
                    crop_name="Cabbage",
                    year=2024,
                    planted_area_ha=1,
                    production_tonnes=2,
                    economic_value_myr=3,
                    district="Ranau",
                ),
                CropStatistic(
                    crop_name="Banana",
                    year=2024,
                    planted_area_ha=4,
                    production_tonnes=5,
                    economic_value_myr=6,
                    district="Papar",
                ),
                CropStatistic(
                    crop_name="Papaya",
                    year=2023,
                    planted_area_ha=7,
                    production_tonnes=8,
                    economic_value_myr=9,
                    district="Papar",
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    @patch("app.services.statistics_service.get_statistics_crop_support")
    def test_options_expose_all_crops_with_support_metadata(self, support):
        support.side_effect = lambda names: [
            {
                "name": name,
                "ml_supported": name == "Banana",
                "prediction_crop_name": "Banana" if name == "Banana" else None,
                "ml_status": "supported" if name == "Banana" else "statistics_only",
                "exclusion_reasons": [] if name == "Banana" else ["Not trained."],
            }
            for name in names
        ]

        result = get_statistics_options(self.db)
        validated = StatisticsOptionsResponse.model_validate(result)

        self.assertEqual(result["crop_names"], ["Banana", "Cabbage", "Papaya"])
        self.assertEqual([crop.name for crop in validated.crops], result["crop_names"])
        self.assertTrue(validated.crops[0].ml_supported)
        support.assert_called_once_with(result["crop_names"])

    def test_crop_statistics_are_not_limited_to_the_legacy_three_crops(self):
        result = get_crop_statistics(
            self.db,
            validate_statistics_filters(crop_name="Papaya"),
        )

        self.assertEqual(result["record_count"], 1)
        self.assertEqual(result["records"][0]["crop_name"], "Papaya")


class BananaHistoryPolicyTests(unittest.TestCase):
    def test_banana_history_is_not_blocked_as_a_removed_crop(self):
        payload = HistoryCreate(
            boundary=[
                [116.0, 5.0],
                [116.1, 5.0],
                [116.1, 5.1],
            ],
            selected_crop="Banana",
            land_cover_result={"land_cover": "cropland"},
        )

        self.assertIsNone(history_save_block_reason(payload))


if __name__ == "__main__":
    unittest.main()
