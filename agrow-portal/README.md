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

## Google Maps in AI Prediction

AI Prediction uses **Maps JavaScript API** for a single Google map with location
search and editable planting boundaries. Submit a village, town, district, or
address (for example `Kampung Bundu Tuhan, Sabah` or `Kg. Bundu Tuhan`) and select a
result to pan/zoom there. Search uses Google's Geocoding service, restricted to
Malaysia and filtered to the Sabah map region. Queries run only on Search/Enter;
there are no per-keystroke requests. Stale results and timeouts are handled.

Choose **Start Boundary**, click to add points, drag Google's vertex handles to
adjust the boundary, and choose **Finish Boundary**. Undo (including Ctrl/Cmd+Z),
GPS points, clearing, district detection, forest overlays, and history restoration
are preserved. Searching and changing map type preserve the current boundary.
Drawing uses native editable Polygon/Polyline classes, not Google's discontinued
Drawing Library. No iframe or separate drawing view is used.

Enable **Maps JavaScript API** and **Geocoding API** in the Google Cloud project,
enable billing, and configure the browser key in `agrow-portal/.env.local`:

```env
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
# Optional: your JavaScript map ID for Advanced Markers (defaults to DEMO_MAP_ID)
VITE_GOOGLE_MAPS_MAP_ID=your_map_id
```

Restrict the key to these APIs and your development/production HTTP referrers.
Restart Vite after editing environment variables and rebuild for deployment.
`ApiNotActivatedMapError` means Maps JavaScript API must be enabled; a denied
geocoding request can mean Geocoding API, billing, or key restrictions need updating.

This is distinct from the free Embed API: [Maps JavaScript API requires billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing).
Google's [global pricing list](https://developers.google.com/maps/billing-and-pricing/pricing)
currently includes 10,000 Dynamic Maps loads/month free, with geocoding priced
separately. Configure API quotas in Google Cloud to manage usage.

AI image analysis still uses the existing Esri satellite source. A temporary
offscreen Leaflet map renders the user-drawn polygon only when analysis requests
an image, then unmounts. Google imagery is never captured or submitted to the AI.

Run the coordinate/search adapter checks with:

```powershell
node --test src/features/prediction/analysis/googleMaps.test.mjs
```
