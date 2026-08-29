import { normalizeSelection } from "./statisticsFilterUtils"
import {
  extractStatisticCropNames,
  normalizeStatisticCropOptions,
} from "./statisticsCropOptions"

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"

export async function fetchStatisticOptions({ signal } = {}) {
  const payload = await apiRequest("/api/statistics/options", { signal })
  const cropNames = uniqueSortedStrings([
    ...(Array.isArray(payload?.crop_names) ? payload.crop_names : []),
    ...extractStatisticCropNames(payload?.crops),
  ])

  return {
    cropNames,
    crops: normalizeStatisticCropOptions(payload?.crops, cropNames),
    districts: uniqueSortedStrings(payload?.districts),
    years: uniqueSortedYears(payload?.years),
    districtsByCrop: normalizeDistrictsByCrop(payload?.districts_by_crop),
  }
}

export async function fetchCropStatistics(filters = {}, { signal } = {}) {
  const params = new URLSearchParams()
  const cropNames = normalizeSelection(filters.cropNames)
  const districts = normalizeSelection(filters.districts)

  params.set("include_records", "false")
  if (cropNames.length) {
    appendRepeatedQueryParameters(params, "crop_names", cropNames)
  } else {
    appendQueryParameter(params, "crop_name", filters.cropName)
  }
  if (districts.length) {
    appendRepeatedQueryParameters(params, "districts", districts)
  } else {
    appendQueryParameter(params, "district", filters.district)
  }
  appendQueryParameter(params, "year", filters.year)
  appendQueryParameter(params, "start_year", filters.startYear)
  appendQueryParameter(params, "end_year", filters.endYear)

  const query = params.toString()
  return apiRequest(`/api/statistics${query ? `?${query}` : ""}`, { signal })
}

function appendQueryParameter(params, key, value) {
  if (value === undefined || value === null || value === "") return
  params.set(key, String(value))
}

function appendRepeatedQueryParameters(params, key, values) {
  normalizeSelection(values).forEach((value) => params.append(key, value))
}

function uniqueSortedStrings(values) {
  if (!Array.isArray(values)) return []

  return [...new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}

function uniqueSortedYears(values) {
  if (!Array.isArray(values)) return []

  return [...new Set(values.map(Number).filter(Number.isInteger))].sort(
    (left, right) => left - right,
  )
}

function normalizeDistrictsByCrop(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .filter(([cropName]) => typeof cropName === "string" && cropName.trim())
      .map(([cropName, districts]) => [
        cropName.trim(),
        uniqueSortedStrings(districts),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

async function apiRequest(path, options = {}) {
  const token =
    sessionStorage.getItem("token") || localStorage.getItem("token")
  let response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (requestError) {
    if (requestError.name === "AbortError") throw requestError
    throw new Error(
      "Unable to reach the Agrow statistics service. Check your connection and try again.",
      { cause: requestError },
    )
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Your session has expired. Please sign in again.")
    }

    if (typeof payload?.detail === "string") {
      throw new Error(payload.detail)
    }

    if (Array.isArray(payload?.detail)) {
      const validationMessage = payload.detail
        .map((error) => error?.msg)
        .filter(Boolean)
        .join(" ")

      if (validationMessage) throw new Error(validationMessage)
    }

    throw new Error("Unable to load crop statistics right now.")
  }

  return payload
}
