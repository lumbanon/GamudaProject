# Agrow API

FastAPI backend for the Agrow crop-planning platform. It provides authentication,
PostGIS environmental queries, crop suitability predictions, agricultural statistics,
analysis history, forest-reserve checks, and optional Gemini insights.

See the [project README](../README.md) for complete database, portal, environment, and
deployment instructions.

## Quick start

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python create_tables.py
python seed.py
python -m uvicorn app.main:app --reload
```

The API runs at `http://127.0.0.1:8000`. Open `http://127.0.0.1:8000/docs` for the
interactive OpenAPI documentation.

## Required configuration

Create `.env` in this directory. Prefer a complete `DATABASE_URL` and always set a
strong `SECRET_KEY` outside local development.

```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/agrow_db
SECRET_KEY=replace_with_a_long_random_value
FRONTEND_URL=http://localhost:5173

# Optional
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
NASA_API_KEY=
```

Without a Gemini key, predictions continue using the built-in rule-based insight.
Model training details are documented in [MODEL_TRAINING.md](MODEL_TRAINING.md).
