import os
from urllib.parse import urlparse

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_MODE = os.getenv("AGROW_DATABASE_MODE", "local").strip().lower()
DATABASE_URL = (
    os.getenv("DATABASE_URL")
    if DATABASE_MODE in {"hosted", "remote", "production"}
    else None
)

if not DATABASE_URL:
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASSWORD = os.getenv("DATABASE_PASSWORD", "")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "agrow_db")
    password_segment = f":{DB_PASSWORD}" if DB_PASSWORD else ""
    DATABASE_URL = f"postgresql://{DB_USER}{password_segment}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if "neon.tech" in DATABASE_URL:
    # Remove channel_binding parameter if present (causes driver issues on psycopg2)
    DATABASE_URL = DATABASE_URL.replace("&channel_binding=require", "").replace("channel_binding=require", "")
    
    # Ensure sslmode=require is attached
    if "sslmode=require" not in DATABASE_URL:
        delimiter = "&" if "?" in DATABASE_URL else "?"
        DATABASE_URL += f"{delimiter}sslmode=require"

IS_LOCAL_DATABASE = urlparse(DATABASE_URL).hostname in {
    "localhost",
    "127.0.0.1",
    "::1",
}

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
