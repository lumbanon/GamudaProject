const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export function isGeminiConfigured() {
  return Boolean(import.meta.env.VITE_GOOGLE_GEMINI_API_KEY);
}

export async function fetchGeminiCropRecommendation(reportData) {
  const apiKey = import.meta.env.VITE_GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    return {
      configured: false,
      recommendation: null,
      message: "Gemini API key is not configured yet.",
    };
  }

  const response = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildRecommendationPrompt(reportData),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to refresh Gemini recommendation right now.");
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  return {
    configured: true,
    recommendation: parseRecommendation(text),
    message: "",
  };
}

function buildRecommendationPrompt(reportData) {
  return `
You are an agricultural GIS advisor for Sabah crop suitability.
Return only valid JSON with these keys:
recommendedCrop, reason, risks, suggestedAction.

Crop: ${reportData.bestCrop}
Alternative crops: ${reportData.alternativeCrops.join(", ")}
District: ${reportData.district}
Coordinates: ${reportData.coordinates.latitude}, ${reportData.coordinates.longitude}
Suitability score: ${reportData.score}/100
Raster source: ${reportData.rasterSource}
Environment values:
- Elevation: ${reportData.environment.elevation}
- Rainfall: ${reportData.environment.rainfall}
- Temperature: ${reportData.environment.temperature}
- Soil pH: ${reportData.environment.soilPh}
- Organic Carbon: ${reportData.environment.organicCarbon}
- Slope: ${reportData.environment.slope}
`.trim();
}

function parseRecommendation(text) {
  if (!text) {
    throw new Error("Gemini returned an empty recommendation.");
  }

  try {
    const parsed = JSON.parse(text);
    return normalizeRecommendation(parsed);
  } catch {
    return {
      recommendedCrop: "Banana",
      reason: text,
      risks: "Review rainfall and slope constraints before final planting.",
      suggestedAction:
        "Validate the field sample and refresh the report with updated raster values.",
    };
  }
}

function normalizeRecommendation(value) {
  return {
    recommendedCrop: value.recommendedCrop || "Banana",
    reason:
      value.reason ||
      "Banana is the best fit for the current district score and environmental profile.",
    risks: value.risks || "Monitor soil pH, slope, and rainfall variability.",
    suggestedAction:
      value.suggestedAction ||
      "Confirm field conditions and plan planting in the recommended window.",
  };
}
