const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"

export async function analyzeCropArea({ crop, polygon }) {
  const token = localStorage.getItem("token")
  const response = await fetch(`${API_BASE_URL}/api/crop-suitability/analyze-area`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ crop, polygon }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.detail || "Unable to analyze this farm area right now.")
  }

  return payload
}
