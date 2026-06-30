const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function fetchGeminiCropRecommendation(reportData) {
  const apiKey = getGeminiApiKey();

  if (!apiKey || apiKey === "xxxx") {
    return {
      configured: false,
      message: "Add VITE_GOOGLE_GEMINI_API_KEY to your .env file to enable Gemini recommendations.",
    };
  }

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildRecommendationPrompt(reportData) }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${errorText || response.statusText}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  const recommendation = parseGeminiRecommendation(text);

  return {
    configured: true,
    recommendation,
  };
}

function getGeminiApiKey() {
  return (
    import.meta.env.VITE_GOOGLE_GEMINI_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    ""
  ).trim();
}

function buildRecommendationPrompt(reportData) {
  return [
    "You are an agronomy assistant for crop planning in Sabah.",
    "Use the provided GIS raster summary to recommend a crop action.",
    "Return only valid JSON with these exact string fields: recommendedCrop, reason, risks, suggestedAction.",
    "",
    `Report data: ${JSON.stringify(reportData)}`,
  ].join("\n");
}

function parseGeminiRecommendation(text) {
  if (!text) {
    throw new Error("Gemini returned an empty recommendation.");
  }

  try {
    const parsed = JSON.parse(text);
    return normalizeRecommendation(parsed);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Gemini returned a response that could not be parsed.");
    }

    return normalizeRecommendation(JSON.parse(jsonMatch[0]));
  }
}

function normalizeRecommendation(value) {
  const source = value && typeof value === "object" ? value : {};

  return {
    recommendedCrop: stringifyField(source.recommendedCrop, "Recommended crop unavailable"),
    reason: stringifyField(source.reason, "Gemini returned a recommendation without a reason."),
    risks: stringifyField(source.risks, "No specific risks returned."),
    suggestedAction: stringifyField(source.suggestedAction, "Validate the recommendation with field observations."),
  };
}

function stringifyField(value, fallback) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}
