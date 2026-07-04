# Agrow API

Agrow API is the Backend for Agrow app

## Environment

Prediction AI insights are generated server-side with Gemini when a backend API key is configured:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-1.5-flash
```

If `GEMINI_API_KEY` is not set, the prediction endpoint keeps working and returns the built-in rule-based insight instead.
The backend also accepts `GOOGLE_GEMINI_API_KEY` or `VITE_GOOGLE_GEMINI_API_KEY` for local migration, but the key should live in `agrow-api/.env`, not the frontend `.env`.
