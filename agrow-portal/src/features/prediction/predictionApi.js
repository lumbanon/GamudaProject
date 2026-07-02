const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"

export async function fetchPredictionCrops() {
  return apiRequest("/api/prediction/crops")
}

export async function fetchPredictionEnvironment({ district } = {}) {
  const params = new URLSearchParams()
  if (district) params.set("district", district)

  const query = params.toString()
  return apiRequest(`/api/prediction/environment${query ? `?${query}` : ""}`)
}

export async function analyzeCropArea({ crop, district, polygon, userInputs }) {
  return apiRequest("/api/prediction/suitability", {
    method: "POST",
    body: JSON.stringify({
      crop,
      district: district || null,
      polygon: polygon?.length ? polygon : null,
      user_inputs: userInputs || null,
    }),
  })
}

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("token")
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.detail || "Unable to reach the prediction service right now.")
  }

  return payload
}
