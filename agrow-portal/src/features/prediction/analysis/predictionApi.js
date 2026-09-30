const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"

export async function fetchPredictionCrops() {
  const payload = await apiRequest("/api/prediction/crops")
  return normalizePredictionCropOptions(payload)
}

export async function predictCropSuitabilityBatch({ cropNames, ...environment }) {
  const normalizedCropNames = normalizePredictionCropOptions(cropNames).map(
    (crop) => crop.name,
  )

  return apiRequest("/api/predict/suitability/batch", {
    method: "POST",
    body: JSON.stringify({
      ...environment,
      ...(normalizedCropNames.length
        ? { crop_names: normalizedCropNames }
        : {}),
    }),
  })
}

export async function fetchPredictionEnvironment({ district } = {}) {
  const params = new URLSearchParams()
  if (district) params.set("district", district)

  const query = params.toString()
  return apiRequest(`/api/prediction/environment${query ? `?${query}` : ""}`)
}

export async function validateForestReserveArea({ polygon }) {
  return apiRequest("/api/prediction/forest-reserve", {
    method: "POST",
    body: JSON.stringify({
      polygon: polygon?.length ? polygon : null,
    }),
  })
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

export function normalizePredictionCropOptions(value) {
  if (!Array.isArray(value)) return []

  const crops = []
  const seenNames = new Set()

  value.forEach((crop) => {
    const option =
      typeof crop === "string"
        ? { name: crop }
        : crop && typeof crop === "object"
          ? crop
          : null
    const name = String(option?.name || "").trim()
    const normalizedName = name.toLocaleLowerCase("en-MY")
    if (!name || seenNames.has(normalizedName)) return

    seenNames.add(normalizedName)
    crops.push({
      ...option,
      name,
      scientific_name:
        typeof option.scientific_name === "string"
          ? option.scientific_name.trim() || null
          : null,
    })
  })

  return crops.sort((left, right) =>
    left.name.localeCompare(right.name, "en-MY", { sensitivity: "base" }),
  )
}

async function apiRequest(path, options = {}) {
  const token =
    sessionStorage.getItem("token") || localStorage.getItem("token")
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
    throw new Error(
      getApiErrorMessage(payload?.detail) ||
        "Unable to reach the prediction service right now.",
    )
  }

  return payload
}

function getApiErrorMessage(detail) {
  if (typeof detail === "string") return detail.trim()
  if (!Array.isArray(detail)) return ""

  return detail
    .map((error) => {
      if (typeof error === "string") return error.trim()
      if (!error || typeof error !== "object") return ""
      return String(error.msg || error.detail || error.message || "").trim()
    })
    .filter(Boolean)
    .join(" ")
}
