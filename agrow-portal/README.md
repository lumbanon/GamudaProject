# Agrow Portal

React and Vite frontend for the Agrow crop-planning platform. It provides the Sabah
district dashboard, suitability heatmaps, farm boundary analysis, crop statistics,
authentication, settings, and saved analysis history.

See the [project README](../README.md) for full backend, database, model, and deployment
instructions.

## Quick start

```powershell
npm ci
```

Create `.env.local` in this directory:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_CARTO_API_KEY=your_carto_basemap_key
```

Then start the portal:

```powershell
npm run dev
```

Open `http://localhost:5173`.

## Commands

```powershell
npm run dev
npm run lint
npm run build
npm run preview
```

`VITE_CARTO_API_KEY` is included in client-side tile requests and should be restricted
to the domains registered with CARTO. Do not place server secrets in `VITE_` variables.
