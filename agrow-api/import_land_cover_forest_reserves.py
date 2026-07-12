import argparse
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv


load_dotenv()

DEFAULT_IMPORT_PATH = Path("exports") / "land_cover_forest_reserves.sql"


def database_config() -> dict[str, str]:
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        parsed = urlparse(database_url)
        return {
            "host": parsed.hostname or "localhost",
            "port": str(parsed.port or 5432),
            "user": unquote(parsed.username or "postgres"),
            "password": unquote(parsed.password or ""),
            "database": (parsed.path or "/agrow_db").lstrip("/"),
        }

    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DATABASE_PASSWORD", ""),
        "database": os.getenv("DB_NAME", "agrow_db"),
    }


def find_psql() -> str:
    configured_path = os.getenv("PSQL_PATH")
    if configured_path:
        return configured_path

    path_tool = shutil.which("psql")
    if path_tool:
        return path_tool

    for version in range(18, 10, -1):
        candidate = Path(f"C:/Program Files/PostgreSQL/{version}/bin/psql.exe")
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(
        "Could not find psql. Add PostgreSQL bin to PATH or set PSQL_PATH in .env."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import real land_cover and forest_reserves tables into PostgreSQL."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_IMPORT_PATH),
        help="Input .sql dump path created by export_land_cover_forest_reserves.py.",
    )
    return parser.parse_args()


def connection_args(config: dict[str, str]) -> list[str]:
    return [
        "-h",
        config["host"],
        "-p",
        config["port"],
        "-U",
        config["user"],
        "-d",
        config["database"],
        "-v",
        "ON_ERROR_STOP=1",
    ]


def main() -> None:
    args = parse_args()
    config = database_config()
    input_path = Path(args.input).resolve()

    if not input_path.is_file():
        raise FileNotFoundError(f"Import file not found: {input_path}")

    psql = find_psql()
    env = os.environ.copy()
    if config["password"]:
        env["PGPASSWORD"] = config["password"]

    base_command = [psql, *connection_args(config)]

    print(f"Preparing PostGIS extensions in {config['database']}...")
    subprocess.run(
        [
            *base_command,
            "-c",
            "CREATE EXTENSION IF NOT EXISTS postgis; "
            "CREATE EXTENSION IF NOT EXISTS postgis_raster;",
        ],
        env=env,
        check=True,
    )

    print(f"Importing land_cover and forest_reserves from {input_path}...")
    subprocess.run(
        [*base_command, "-f", str(input_path)],
        env=env,
        check=True,
    )
    print("Import complete.")


if __name__ == "__main__":
    main()
