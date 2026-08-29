<p align="center">
  <img src="agrow-portal/src/assets/landing/agrow-rectangle.png" alt="Agrow" width="260">
</p>

<h1 align="center">Agrow Ecosystem</h1>

<p align="center">
  A GIS and machine-learning decision-support platform for crop planning in Sabah, Malaysia.
</p>

Agrow combines district-level agricultural statistics, PostGIS environmental data,
crop suitability models, interactive maps, and optional Gemini insights in one web
application. It is designed to help users compare crops, inspect local conditions,
analyze a proposed farm boundary, and retain previous analyses.

## Core capabilities

- Interactive Sabah district dashboard with crop suitability summaries.
- Crop suitability heatmaps backed by the prediction API.
- Farm boundary drawing, environmental sampling, and suitability analysis.
- Satellite-assisted built-up-area checks and forest-reserve validation.
- Agricultural production statistics with year, district, and crop filters.
- Account registration, authentication, settings, and user-owned analysis history.
- Data-driven crop registry shared by the model, API, dashboard, and statistics views.
- Reproducible Random Forest training with model metadata and validation artifacts.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Portal | React 19, Vite 8, React Router | User interface and client-side workflows |
| Maps | Leaflet, React-Leaflet, CARTO, Esri | District, heatmap, satellite, and boundary views |
| API | FastAPI, Pydantic, SQLAlchemy | Authentication, predictions, history, and statistics |
| Database | PostgreSQL, PostGIS | Users, crop requirements, statistics, and spatial grids |
| ML | scikit-learn, pandas, NumPy, joblib | Crop registry validation and suitability classification |
| AI | Google Gemini, optional | Natural-language insights and satellite-image review |

## Repository layout

```text
agrow-ecosystem/
|-- agrow-api/
|   |-- app/
|   |   |-- api/endpoints/       # FastAPI route handlers
|   |   |-- database/            # SQLAlchemy engine and sessions
|   |   |-- ml_assets/           # Deployed model, encoder, and metadata
|   |   |-- models/              # Database models
|   |   |-- schemas/             # Request and response contracts
|   |   `-- services/            # Prediction, statistics, history, and AI logic
|   |-- migrations/              # SQL migrations
|   |-- outputs/                 # Model-training reports
|   |-- create_tables.py
|   |-- seed.py
|   `-- train_model.py
|-- agrow-portal/
|   |-- public/
|   `-- src/
|       |-- assets/
|       |-- context/
|       |-- features/
|       |-- layouts/
|       `-- routes/
`-- README.md
```

## Requirements

- Python 3.12
- Node.js `^20.19.0` or `>=22.12.0`
- PostgreSQL with the PostGIS extension
- A CARTO basemap key for authenticated map tiles
- A Gemini API key only when AI-generated insights are required

## Local setup

### 1. Clone the repository

```powershell
git clone https://github.com/lumbanon/GamudaProject.git
cd GamudaProject
```

### 2. Prepare PostgreSQL

Create a database and enable PostGIS. The default local database name used by the
application is `agrow_db`.

```sql
CREATE DATABASE agrow_db;
```

Connect to `agrow_db`, then run:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 3. Configure and start the API

```powershell
cd agrow-api
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Create `agrow-api/.env`:

```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/agrow_db
SECRET_KEY=replace_with_a_long_random_value
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
FRONTEND_URL=http://localhost:5173

# Optional integrations
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
NASA_API_KEY=
```

Initialize a fresh database and start the API:

```powershell
python create_tables.py
python seed.py
python -m uvicorn app.main:app --reload
```

`seed.py` is intended for a fresh database. It refuses to overwrite an existing
populated spatial grid.

The API is available at `http://127.0.0.1:8000`, with interactive documentation at
`http://127.0.0.1:8000/docs`.

### 4. Configure and start the portal

Open another terminal:

```powershell
cd agrow-portal
npm ci
```

Create `agrow-portal/.env.local`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_CARTO_API_KEY=your_carto_basemap_key
```

Start Vite:

```powershell
npm run dev
```

Open `http://localhost:5173`.

## Environment variables

### API

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Recommended | Complete PostgreSQL connection URL |
| `DB_USER`, `DATABASE_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | Alternative | Components used when `DATABASE_URL` is absent |
| `SECRET_KEY` | Production | Signs authentication tokens |
| `ALGORITHM` | No | JWT algorithm; defaults to `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | Authentication token lifetime |
| `FRONTEND_URL` | Production | Adds the deployed portal origin to CORS |
| `GEMINI_API_KEY` | No | Enables generated agricultural insights |
| `GEMINI_MODEL` | No | Overrides the default Gemini model |
| `GEMINI_VISION_MODEL` | No | Optional model override for image analysis |
| `NASA_API_KEY` | Seeding only | Used by environmental data seeding |
| `PSQL_PATH` | Import only | Optional path to the PostgreSQL CLI executable |

### Portal

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Production | Public URL of the deployed FastAPI service |
| `VITE_CARTO_API_KEY` | Maps | Authenticates CARTO Voyager tile requests |

Vite variables are bundled into browser code. The CARTO key is therefore visible in
tile requests by design; restrict it to the domains registered with CARTO. Never place
database credentials or server-side API secrets in a `VITE_` variable.

## Useful commands

### API

Run these commands from `agrow-api`:

```powershell
# Start the development API
python -m uvicorn app.main:app --reload

# Create PostGIS and application tables
python create_tables.py

# Populate a fresh database
python seed.py

# Import land-cover and forest-reserve data
python import_land_cover_forest_reserves.py

# Rebuild the crop classifier and metadata
python train_model.py
```

### Portal

Run these commands from `agrow-portal`:

```powershell
npm run dev      # Development server
npm run lint     # ESLint checks
npm run build    # Production bundle
npm run preview  # Preview the production bundle
```

## Data and model workflow

The prediction crop list is not hard-coded in the portal. Training validates the crop
requirements and available evidence, trains the classifier, and writes a registry
snapshot to `agrow-api/app/ml_assets/crop_model_metadata.json`. The API uses that
metadata to expose supported crops consistently across prediction and dashboard views.

Training reports are written to `agrow-api/outputs`. See
[`agrow-api/MODEL_TRAINING.md`](agrow-api/MODEL_TRAINING.md) for eligibility rules,
data-leakage controls, generated artifacts, and interpretation limitations.

The model target is derived from crop requirements and productive historical districts;
it is not a field-observed agronomic suitability label. Treat reported metrics as
pipeline validation rather than field-validated accuracy.

## API overview

| Prefix | Purpose |
| --- | --- |
| `/api/v1/auth` | Registration, login, profile, password, and account management |
| `/api/predict` | Single and batch ML suitability predictions |
| `/api/prediction` | Crop catalog, environment, forest reserve, and detailed analysis |
| `/api/statistics` | Filter options and aggregated crop production statistics |
| `/api/history` | Authenticated analysis history CRUD and restore operations |
| `/docs` | OpenAPI documentation provided by FastAPI |

## Deployment

### Portal

Deploy `agrow-portal` as the project root on Vercel or another static host.

- Build command: `npm run build`
- Output directory: `dist`
- Set `VITE_API_BASE_URL` and `VITE_CARTO_API_KEY` before building.
- `vercel.json` already rewrites client-side routes to `index.html`.

### API

Deploy `agrow-api` to a Python host with PostgreSQL/PostGIS access.

```text
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Set `DATABASE_URL`, `SECRET_KEY`, and `FRONTEND_URL` in the host environment. Add the
optional Gemini variables only when generated insights are enabled.

## Security and repository notes

- `.env` and `.env.local` are ignored by Git; keep all real credentials there or in
  the deployment provider's secret store.
- Use a strong, unique `SECRET_KEY` in every deployed environment.
- Review the target database before running seed or import scripts.
- The repository contains a model artifact larger than GitHub's recommended 50 MB
  threshold. Use Git LFS if future model versions grow substantially.
