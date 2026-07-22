import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.endpoints import statistics
from app.database.session import get_db
from app.models.crop_statistic import CropStatistic


@pytest.fixture()
def statistics_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    CropStatistic.__table__.create(bind=engine)
    testing_session = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
    )

    with testing_session() as db:
        db.add_all(
            [
                CropStatistic(
                    id=1,
                    crop_name="Banana",
                    year=2020,
                    planted_area_ha=10,
                    production_tonnes=20,
                    economic_value_myr=100,
                    district="Alpha",
                ),
                CropStatistic(
                    id=2,
                    crop_name="Durian",
                    year=2021,
                    planted_area_ha=0,
                    production_tonnes=5,
                    economic_value_myr=50,
                    district="Beta",
                ),
                CropStatistic(
                    id=3,
                    crop_name="Banana",
                    year=2022,
                    planted_area_ha=30,
                    production_tonnes=90,
                    economic_value_myr=900,
                    district="Beta",
                ),
                CropStatistic(
                    id=4,
                    crop_name="Watermelon",
                    year=2022,
                    planted_area_ha=5,
                    production_tonnes=0,
                    economic_value_myr=None,
                    district=None,
                ),
                CropStatistic(
                    id=5,
                    crop_name="Watermelon",
                    year=2022,
                    planted_area_ha=0,
                    production_tonnes=0,
                    economic_value_myr=None,
                    district="Alpha",
                ),
                CropStatistic(
                    id=7,
                    crop_name="Papaya",
                    year=2024,
                    planted_area_ha=100,
                    production_tonnes=500,
                    economic_value_myr=1000,
                    district="Gamma",
                ),
            ]
        )
        db.commit()
        db.query(CropStatistic).filter(CropStatistic.id == 4).update(
            {CropStatistic.district: None}
        )
        db.commit()

    app = FastAPI()
    app.state.statistics_test_engine = engine
    app.include_router(
        statistics.router,
        prefix="/api/statistics",
    )

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as client:
        yield client

    engine.dispose()


def test_statistics_response_uses_records_and_weighted_aggregates(
    statistics_client,
):
    response = statistics_client.get("/api/statistics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["record_count"] == 5
    assert [record["id"] for record in payload["records"]] == [1, 2, 3, 4, 5]

    summary = payload["summary"]
    assert summary["total_planted_area_ha"] == 45
    assert summary["total_production_tonnes"] == 115
    assert summary["total_economic_value_myr"] == 1050
    assert summary["average_yield_tonnes_per_ha"] == pytest.approx(115 / 45)

    zero_area_record = payload["records"][1]
    assert zero_area_record["production_tonnes"] == 5
    assert zero_area_record["yield_tonnes_per_ha"] == 0

    null_value_record = payload["records"][3]
    assert null_value_record["economic_value_myr"] == 0

    assert [item["year"] for item in payload["yearly_trends"]] == [
        2020,
        2021,
        2022,
    ]
    assert payload["yearly_trends"][1]["yield_tonnes_per_ha"] == 0
    assert [item["crop_name"] for item in payload["crop_comparison"]] == [
        "Banana",
        "Durian",
        "Watermelon",
    ]
    assert [item["district"] for item in payload["district_comparison"]] == [
        "Beta",
        "Alpha",
        None,
    ]
    assert [
        (item["year"], item["crop_name"])
        for item in payload["crop_yearly_trends"]
    ] == [
        (2020, "Banana"),
        (2021, "Durian"),
        (2022, "Banana"),
        (2022, "Watermelon"),
    ]
    assert [
        (item["year"], item["district"])
        for item in payload["district_yearly_trends"]
    ] == [
        (2020, "Alpha"),
        (2021, "Beta"),
        (2022, None),
        (2022, "Beta"),
    ]
    assert [
        (item["district"], item["crop_name"])
        for item in payload["crop_district_comparison"]
    ] == [
        (None, "Watermelon"),
        ("Alpha", "Banana"),
        ("Beta", "Banana"),
        ("Beta", "Durian"),
    ]


@pytest.mark.parametrize(
    ("params", "expected_ids"),
    [
        ({"crop_name": "  bAnAnA  "}, [1, 3]),
        ({"district": "  bEtA  "}, [2, 3]),
        ({"year": 2022}, [3, 4, 5]),
        ({"start_year": 2022}, [3, 4, 5]),
        ({"end_year": 2020}, [1]),
        ({"start_year": 2021, "end_year": 2021}, [2]),
    ],
)
def test_statistics_filters(statistics_client, params, expected_ids):
    response = statistics_client.get("/api/statistics", params=params)

    assert response.status_code == 200
    payload = response.json()
    assert payload["record_count"] == len(expected_ids)
    assert [record["id"] for record in payload["records"]] == expected_ids


@pytest.mark.parametrize(
    ("params", "expected_ids"),
    [
        ([('crop_names', 'Banana')], [1, 3]),
        (
            [('crop_names', 'Banana'), ('crop_names', 'Durian')],
            [1, 2, 3],
        ),
        ([('districts', 'Beta')], [2, 3]),
        (
            [('districts', 'Alpha'), ('districts', 'Beta')],
            [1, 2, 3, 5],
        ),
        (
            [
                ('crop_names', 'Banana'),
                ('crop_names', 'Watermelon'),
                ('districts', 'Alpha'),
                ('districts', 'Beta'),
            ],
            [1, 3, 5],
        ),
        (
            [
                ('crop_names', 'Banana'),
                ('crop_names', 'Durian'),
                ('start_year', '2021'),
            ],
            [2, 3],
        ),
    ],
)
def test_statistics_plural_filters(statistics_client, params, expected_ids):
    response = statistics_client.get("/api/statistics", params=params)

    assert response.status_code == 200
    payload = response.json()
    assert payload["record_count"] == len(expected_ids)
    assert [record["id"] for record in payload["records"]] == expected_ids


def test_statistics_combines_normalizes_and_deduplicates_filter_forms(
    statistics_client,
):
    response = statistics_client.get(
        "/api/statistics",
        params=[
            ("crop_name", "  banana  "),
            ("crop_names", "BANANA"),
            ("crop_names", "  Durian "),
            ("crop_names", "durian"),
            ("district", " beta "),
            ("districts", "BETA"),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert [record["id"] for record in payload["records"]] == [2, 3]
    assert {
        item["crop_name"] for item in payload["crop_comparison"]
    } == {"Banana", "Durian"}
    assert [
        item["district"] for item in payload["district_comparison"]
    ] == ["Beta"]


def test_statistics_returns_one_canonical_database_label_per_identity(
    statistics_client,
):
    engine = statistics_client.app.state.statistics_test_engine
    testing_session = sessionmaker(bind=engine)
    with testing_session() as db:
        db.add(
            CropStatistic(
                id=6,
                crop_name="banana",
                year=2023,
                planted_area_ha=2,
                production_tonnes=4,
                economic_value_myr=20,
                district="alpha",
            )
        )
        db.commit()

    response = statistics_client.get(
        "/api/statistics",
        params={"crop_names": "BANANA", "districts": "ALPHA"},
    )
    options_response = statistics_client.get("/api/statistics/options")

    assert response.status_code == 200
    payload = response.json()
    assert [record["crop_name"] for record in payload["records"]] == [
        "Banana",
        "Banana",
    ]
    assert [record["district"] for record in payload["records"]] == [
        "Alpha",
        "Alpha",
    ]
    assert [
        item["crop_name"] for item in payload["crop_comparison"]
    ] == ["Banana"]
    assert options_response.status_code == 200
    options = options_response.json()
    assert options["crop_names"].count("Banana") == 1
    assert "banana" not in options["crop_names"]
    assert options["districts"].count("Alpha") == 1
    assert "alpha" not in options["districts"]


def test_statistics_uses_or_within_groups_and_and_between_groups(
    statistics_client,
):
    response = statistics_client.get(
        "/api/statistics",
        params=[
            ("crop_names", "Banana"),
            ("crop_names", "Durian"),
            ("districts", "Alpha"),
        ],
    )

    assert response.status_code == 200
    assert [
        record["id"] for record in response.json()["records"]
    ] == [1]


@pytest.mark.parametrize(
    "params",
    [
        {"crop_name": "   "},
        {"district": "\t"},
        {"year": 2020, "start_year": 2020},
        {"year": 2020, "end_year": 2020},
        {"start_year": 2022, "end_year": 2021},
        {"year": 1899},
        {"start_year": 2101},
    ],
)
def test_statistics_rejects_invalid_filters(statistics_client, params):
    response = statistics_client.get("/api/statistics", params=params)

    assert response.status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        [("crop_names", "   ")],
        [("districts", "\t")],
        [("crop_names", "x" * 101)],
        [("districts", "x" * 101)],
    ],
)
def test_statistics_rejects_invalid_plural_filters(
    statistics_client,
    params,
):
    response = statistics_client.get("/api/statistics", params=params)

    assert response.status_code == 422


def test_statistics_returns_zeroed_empty_response(statistics_client):
    response = statistics_client.get(
        "/api/statistics",
        params={"crop_name": "Not A Crop"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "record_count": 0,
        "records": [],
        "summary": {
            "total_planted_area_ha": 0,
            "total_production_tonnes": 0,
            "total_economic_value_myr": 0,
            "average_yield_tonnes_per_ha": 0,
        },
        "yearly_trends": [],
        "crop_yearly_trends": [],
        "district_yearly_trends": [],
        "crop_comparison": [],
        "district_comparison": [],
        "crop_district_comparison": [],
    }


def test_statistics_plural_filter_can_return_no_matches(statistics_client):
    response = statistics_client.get(
        "/api/statistics",
        params=[("crop_names", "Not A Crop")],
    )

    assert response.status_code == 200
    assert response.json()["record_count"] == 0
    assert response.json()["crop_district_comparison"] == []


def test_statistics_omits_zero_only_crop_district_groups(
    statistics_client,
):
    response = statistics_client.get(
        "/api/statistics",
        params=[
            ("crop_names", "Banana"),
            ("crop_names", "Durian"),
            ("districts", "Alpha"),
            ("districts", "Beta"),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    comparisons = payload["crop_district_comparison"]
    assert {
        (item["district"], item["crop_name"])
        for item in comparisons
    } == {
        ("Alpha", "Banana"),
        ("Beta", "Banana"),
        ("Beta", "Durian"),
    }
    assert ("Alpha", "Durian") not in {
        (item["district"], item["crop_name"])
        for item in comparisons
    }


def test_statistics_omits_all_zero_groups_but_preserves_real_record(
    statistics_client,
):
    response = statistics_client.get(
        "/api/statistics",
        params={"crop_name": "Watermelon", "district": "Alpha"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["record_count"] == 1
    assert [record["id"] for record in payload["records"]] == [5]
    assert payload["summary"] == {
        "total_planted_area_ha": 0,
        "total_production_tonnes": 0,
        "total_economic_value_myr": 0,
        "average_yield_tonnes_per_ha": 0,
    }
    for field_name in (
        "yearly_trends",
        "crop_yearly_trends",
        "district_yearly_trends",
        "crop_comparison",
        "district_comparison",
        "crop_district_comparison",
    ):
        assert payload[field_name] == []


def test_statistics_preserves_partial_data_with_safe_zero_area_yield(
    statistics_client,
):
    response = statistics_client.get(
        "/api/statistics",
        params={"crop_name": "Durian", "district": "Beta"},
    )

    assert response.status_code == 200
    payload = response.json()
    comparison = payload["crop_district_comparison"]
    assert len(comparison) == 1
    assert comparison[0] == {
        "crop_name": "Durian",
        "district": "Beta",
        "planted_area_ha": 0,
        "production_tonnes": 5,
        "economic_value_myr": 50,
        "yield_tonnes_per_ha": 0,
    }


def test_statistics_grouped_yearly_data_omits_missing_points(
    statistics_client,
):
    response = statistics_client.get(
        "/api/statistics",
        params=[
            ("crop_names", "Banana"),
            ("crop_names", "Durian"),
            ("districts", "Alpha"),
            ("districts", "Beta"),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert [
        (item["year"], item["crop_name"])
        for item in payload["crop_yearly_trends"]
    ] == [
        (2020, "Banana"),
        (2021, "Durian"),
        (2022, "Banana"),
    ]
    assert [
        (item["year"], item["district"])
        for item in payload["district_yearly_trends"]
    ] == [
        (2020, "Alpha"),
        (2021, "Beta"),
        (2022, "Beta"),
    ]


def test_statistics_can_omit_records_without_changing_aggregates(
    statistics_client,
):
    full_response = statistics_client.get("/api/statistics")
    compact_response = statistics_client.get(
        "/api/statistics",
        params={"include_records": False},
    )

    assert full_response.status_code == 200
    assert compact_response.status_code == 200

    full_payload = full_response.json()
    compact_payload = compact_response.json()
    assert compact_payload["record_count"] == 5
    assert compact_payload["records"] == []
    assert compact_payload["summary"] == full_payload["summary"]
    assert compact_payload["yearly_trends"] == full_payload["yearly_trends"]
    assert (
        compact_payload["crop_yearly_trends"]
        == full_payload["crop_yearly_trends"]
    )
    assert (
        compact_payload["district_yearly_trends"]
        == full_payload["district_yearly_trends"]
    )
    assert compact_payload["crop_comparison"] == full_payload["crop_comparison"]
    assert (
        compact_payload["district_comparison"]
        == full_payload["district_comparison"]
    )
    assert (
        compact_payload["crop_district_comparison"]
        == full_payload["crop_district_comparison"]
    )


def test_statistics_options_are_unfiltered_and_sorted(statistics_client):
    response = statistics_client.get("/api/statistics/options")

    assert response.status_code == 200
    assert response.json() == {
        "crop_names": ["Banana", "Durian", "Watermelon"],
        "districts": ["Alpha", "Beta"],
        "years": [2020, 2021, 2022],
        "districts_by_crop": {
            "Banana": ["Alpha", "Beta"],
            "Durian": ["Beta"],
            "Watermelon": [],
        },
    }


def test_statistics_excludes_crops_outside_the_supported_four(
    statistics_client,
):
    response = statistics_client.get("/api/statistics")
    options_response = statistics_client.get("/api/statistics/options")

    assert response.status_code == 200
    assert options_response.status_code == 200
    assert "Papaya" not in {
        record["crop_name"] for record in response.json()["records"]
    }
    assert "Papaya" not in options_response.json()["crop_names"]
    assert "Gamma" not in options_response.json()["districts"]


def test_statistics_main_request_uses_one_select_query(statistics_client):
    engine = statistics_client.app.state.statistics_test_engine
    select_statements = []

    def capture_select(
        connection,
        cursor,
        statement,
        parameters,
        context,
        executemany,
    ):
        del connection, cursor, parameters, context, executemany
        if statement.lstrip().upper().startswith("SELECT"):
            select_statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_select)
    try:
        response = statistics_client.get(
            "/api/statistics",
            params=[
                ("crop_names", "Banana"),
                ("crop_names", "Durian"),
                ("districts", "Alpha"),
                ("districts", "Beta"),
                ("include_records", "false"),
            ],
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_select)

    assert response.status_code == 200
    assert len(select_statements) == 1
