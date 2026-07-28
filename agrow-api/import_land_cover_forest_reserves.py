import argparse
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import psycopg2
from dotenv import load_dotenv


load_dotenv()

DEFAULT_IMPORT_PATH = Path("exports") / "land_cover_forest_reserves.sql"


def database_config() -> dict[str, str]:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is required. Refusing to fall back to a local PostgreSQL database."
        )

    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection URL.")
    if parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("DATABASE_URL points to localhost; refusing to run the production import.")

    query = parse_qs(parsed.query)
    return {
        "url": database_url,
        "host": parsed.hostname or "",
        "port": str(parsed.port or 5432),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": unquote((parsed.path or "").lstrip("/")),
        "sslmode": query.get("sslmode", ["require"])[0],
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
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Allow the dump to replace non-empty land_cover or forest_reserves tables.",
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


def print_sanitized_database_target(config: dict[str, str]) -> None:
    print("Target PostgreSQL database:")
    print(f"  host: {config['host']}")
    print(f"  database: {config['database']}")
    print(f"  user: {config['user']}")
    print("  password: present (hidden)")
    print(f"  SSL mode: {config['sslmode']}")


def existing_target_counts(config: dict[str, str]) -> dict[str, int]:
    counts = {}
    connection = psycopg2.connect(
        config["url"],
        sslmode=config["sslmode"],
    )
    try:
        with connection.cursor() as cursor:
            for table_name in ("forest_reserves", "land_cover"):
                cursor.execute("SELECT to_regclass(%s)", (f"public.{table_name}",))
                if cursor.fetchone()[0] is None:
                    counts[table_name] = 0
                    continue
                cursor.execute(f"SELECT COUNT(*) FROM public.{table_name}")
                counts[table_name] = int(cursor.fetchone()[0])
    finally:
        connection.close()
    return counts


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
    env["PGSSLMODE"] = config["sslmode"]

    base_command = [psql, *connection_args(config)]

    print_sanitized_database_target(config)
    target_counts = existing_target_counts(config)
    print(
        "Existing target rows: "
        + ", ".join(f"{table}={count}" for table, count in target_counts.items())
    )
    populated_tables = {
        table: count for table, count in target_counts.items() if count > 0
    }
    if populated_tables and not args.replace_existing:
        populated = ", ".join(
            f"{table}={count}" for table, count in populated_tables.items()
        )
        raise RuntimeError(
            "Refusing to replace populated spatial tables without "
            f"--replace-existing: {populated}"
        )

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
