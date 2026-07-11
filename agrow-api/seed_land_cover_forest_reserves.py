import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError


load_dotenv()

SEED_SOURCE = "seed_land_cover_forest_reserves.py"

FOREST_RESERVE_SAMPLES = [
    {
        "name": "Kinabalu Park Forest Reserve Sample",
        "district": "Ranau",
        "reserve_type": "Protected forest",
        "wkt": "POLYGON((116.45 5.88,116.75 5.88,116.75 6.18,116.45 6.18,116.45 5.88))",
    },
    {
        "name": "Crocker Range Forest Reserve Sample",
        "district": "Keningau",
        "reserve_type": "Protected forest",
        "wkt": "POLYGON((115.80 5.18,116.48 5.18,116.48 5.96,115.80 5.96,115.80 5.18))",
    },
    {
        "name": "Kabili-Sepilok Forest Reserve Sample",
        "district": "Sandakan",
        "reserve_type": "Protected forest",
        "wkt": "POLYGON((117.88 5.80,118.18 5.80,118.18 5.99,117.88 5.99,117.88 5.80))",
    },
    {
        "name": "Tawau Hills Forest Reserve Sample",
        "district": "Tawau",
        "reserve_type": "Protected forest",
        "wkt": "POLYGON((117.78 4.25,118.10 4.25,118.10 4.54,117.78 4.54,117.78 4.25))",
    },
]

LAND_COVER_RASTER_SAMPLES = [
    {
        "label": "built-up",
        "code": 50,
        "district": "Kota Kinabalu",
        "bbox": (116.045, 5.925, 116.155, 6.015),
    },
    {
        "label": "built-up",
        "code": 50,
        "district": "Sandakan",
        "bbox": (118.045, 5.805, 118.175, 5.900),
    },
    {
        "label": "built-up",
        "code": 50,
        "district": "Tawau",
        "bbox": (117.835, 4.190, 117.955, 4.310),
    },
    {
        "label": "mangrove",
        "code": 95,
        "district": "Kudat",
        "bbox": (116.735, 6.780, 116.930, 6.950),
    },
    {
        "label": "water",
        "code": 80,
        "district": "Semporna",
        "bbox": (118.540, 4.380, 118.700, 4.560),
    },
]

def build_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return database_url

    db_user = os.getenv("DB_USER", "postgres")
    db_password = os.getenv("DATABASE_PASSWORD", "")
    db_host = os.getenv("DB_HOST", "localhost")
    db_port = os.getenv("DB_PORT", "5432")
    db_name = os.getenv("DB_NAME", "agrow_db")
    password_segment = f":{db_password}" if db_password else ""
    return f"postgresql://{db_user}{password_segment}@{db_host}:{db_port}/{db_name}"


def initialize_extensions(connection) -> None:
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis_raster;"))


def create_forest_reserves_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.forest_reserves (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                district TEXT,
                reserve_type TEXT DEFAULT 'Forest Reserve',
                source TEXT DEFAULT 'seed_land_cover_forest_reserves.py',
                geom geometry(MultiPolygon, 4326) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            );
            """
        )
    )
    connection.execute(text("ALTER TABLE public.forest_reserves ADD COLUMN IF NOT EXISTS name TEXT;"))
    connection.execute(text("ALTER TABLE public.forest_reserves ADD COLUMN IF NOT EXISTS district TEXT;"))
    connection.execute(text("ALTER TABLE public.forest_reserves ADD COLUMN IF NOT EXISTS reserve_type TEXT;"))
    connection.execute(text("ALTER TABLE public.forest_reserves ADD COLUMN IF NOT EXISTS source TEXT;"))
    connection.execute(text("ALTER TABLE public.forest_reserves ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);"))
    connection.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS forest_reserves_geom_gix
            ON public.forest_reserves
            USING GIST (geom);
            """
        )
    )


def seed_forest_reserves(connection, geojson_path: str | None) -> int:
    connection.execute(
        text("DELETE FROM public.forest_reserves WHERE source = :source;"),
        {"source": SEED_SOURCE},
    )

    if geojson_path:
        return seed_forest_reserves_from_geojson(connection, geojson_path)

    inserted = 0
    for reserve in FOREST_RESERVE_SAMPLES:
        connection.execute(
            text(
                """
                INSERT INTO public.forest_reserves (name, district, reserve_type, source, geom)
                VALUES (
                    :name,
                    :district,
                    :reserve_type,
                    :source,
                    ST_Multi(ST_SetSRID(ST_MakeValid(ST_GeomFromText(:wkt)), 4326))
                );
                """
            ),
            {**reserve, "source": SEED_SOURCE},
        )
        inserted += 1
    return inserted


def seed_forest_reserves_from_geojson(connection, geojson_path: str) -> int:
    path = Path(geojson_path)
    data = json.loads(path.read_text(encoding="utf-8"))
    features = data.get("features", [])
    inserted = 0

    for index, feature in enumerate(features, start=1):
        geometry = feature.get("geometry")
        if not geometry:
            continue

        properties = feature.get("properties") or {}
        name = first_text(properties, ["name", "reserve_name", "forest_name", "NAME"]) or f"Forest Reserve {index}"
        district = first_text(properties, ["district", "district_name", "DISTRICT"])
        reserve_type = first_text(properties, ["reserve_type", "type", "TYPE"]) or "Forest Reserve"

        connection.execute(
            text(
                """
                INSERT INTO public.forest_reserves (name, district, reserve_type, source, geom)
                VALUES (
                    :name,
                    :district,
                    :reserve_type,
                    :source,
                    ST_Multi(ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON(:geometry)), 4326))
                );
                """
            ),
            {
                "name": name,
                "district": district,
                "reserve_type": reserve_type,
                "source": SEED_SOURCE,
                "geometry": json.dumps(geometry),
            },
        )
        inserted += 1

    return inserted


def create_land_cover_raster_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.land_cover (
                rid SERIAL PRIMARY KEY,
                code INTEGER NOT NULL,
                label TEXT NOT NULL,
                district TEXT,
                source TEXT DEFAULT 'seed_land_cover_forest_reserves.py',
                rast raster NOT NULL
            );
            """
        )
    )
    connection.execute(text("ALTER TABLE public.land_cover ADD COLUMN IF NOT EXISTS code INTEGER;"))
    connection.execute(text("ALTER TABLE public.land_cover ADD COLUMN IF NOT EXISTS label TEXT;"))
    connection.execute(text("ALTER TABLE public.land_cover ADD COLUMN IF NOT EXISTS district TEXT;"))
    connection.execute(text("ALTER TABLE public.land_cover ADD COLUMN IF NOT EXISTS source TEXT;"))
    connection.execute(text("ALTER TABLE public.land_cover ADD COLUMN IF NOT EXISTS rast raster;"))
    connection.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS land_cover_rast_gix
            ON public.land_cover
            USING GIST (ST_ConvexHull(rast));
            """
        )
    )


def seed_land_cover_rasters(connection) -> int:
    connection.execute(
        text("DELETE FROM public.land_cover WHERE source = :source;"),
        {"source": SEED_SOURCE},
    )

    inserted = 0
    for sample in LAND_COVER_RASTER_SAMPLES:
        minx, miny, maxx, maxy = sample["bbox"]
        width = 12
        height = 12
        pixel_width = (maxx - minx) / width
        pixel_height = -((maxy - miny) / height)

        connection.execute(
            text(
                """
                INSERT INTO public.land_cover (code, label, district, source, rast)
                VALUES (
                    :code,
                    :label,
                    :district,
                    :source,
                    ST_AddBand(
                        ST_MakeEmptyRaster(
                            :width,
                            :height,
                            :upper_left_x,
                            :upper_left_y,
                            :pixel_width,
                            :pixel_height,
                            0,
                            0,
                            4326
                        ),
                        '8BUI',
                        :code,
                        0
                    )
                );
                """
            ),
            {
                "code": sample["code"],
                "label": sample["label"],
                "district": sample["district"],
                "source": SEED_SOURCE,
                "width": width,
                "height": height,
                "upper_left_x": minx,
                "upper_left_y": maxy,
                "pixel_width": pixel_width,
                "pixel_height": pixel_height,
            },
        )
        inserted += 1
    return inserted


def first_text(properties: dict, keys: list[str]) -> str | None:
    for key in keys:
        value = properties.get(key)
        if value:
            return str(value)
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed PostGIS land_cover and forest_reserves data for Agrow prediction."
    )
    parser.add_argument(
        "--forest-geojson",
        default=os.getenv("FOREST_RESERVES_GEOJSON"),
        help="Optional GeoJSON FeatureCollection path for real forest reserves.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    engine = create_engine(build_database_url(), pool_pre_ping=True)

    print("Connecting to PostgreSQL/PostGIS...")
    with engine.begin() as connection:
        initialize_extensions(connection)
        create_forest_reserves_table(connection)
        create_land_cover_raster_table(connection)

        forest_count = seed_forest_reserves(connection, args.forest_geojson)
        land_cover_count = seed_land_cover_rasters(connection)

    print(f"Seeded {forest_count} forest reserve records.")
    print(f"Seeded {land_cover_count} land cover raster tiles.")
    print("Done.")


if __name__ == "__main__":
    try:
        main()
    except SQLAlchemyError as exc:
        print(f"Database error: {exc}")
        raise
