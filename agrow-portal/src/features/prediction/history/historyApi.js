const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"

export function saveAnalysisHistory(payload, idempotencyKey) {
  return historyRequest("/api/history", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  })
}

export function fetchAnalysisHistory(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      query.set(key, String(value))
    }
  })
  return historyRequest(`/api/history${query.size ? `?${query}` : ""}`)
}

export function fetchAnalysisHistoryRecord(historyId) {
  return historyRequest(`/api/history/${historyId}`)
}

export function renameAnalysisHistory(historyId, name) {
  return historyRequest(`/api/history/${historyId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  })
}

export function deleteAnalysisHistory(historyId) {
  return historyRequest(`/api/history/${historyId}`, { method: "DELETE" })
}

export function restoreAnalysisHistory(historyId) {
  return historyRequest(`/api/history/${historyId}/restore`, { method: "POST" })
}

async function historyRequest(path, options = {}) {
  const token = sessionStorage.getItem("token") || localStorage.getItem("token")
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (response.status === 204) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.detail || "Unable to access analysis history right now.")
  }
  return payload
}
