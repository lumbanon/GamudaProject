export function extractStatisticCropNames(values) {
  if (!Array.isArray(values)) return []

  return values
    .map((value) => {
      if (!value || typeof value !== "object") return ""
      return cleanString(value.name || value.crop_name)
    })
    .filter(Boolean)
}

export function normalizeStatisticCropOptions(values, cropNames) {
  const metadataByName = new Map()

  if (Array.isArray(values)) {
    values.forEach((value) => {
      if (!value || typeof value !== "object") return

      const name = cleanString(value.name || value.crop_name)
      const key = normalizeName(name)
      if (!key || metadataByName.has(key)) return
      metadataByName.set(key, value)
    })
  }

  return uniqueStrings(cropNames).map((name) => {
    const metadata = metadataByName.get(normalizeName(name)) || {}
    const rawMlSupported = metadata.ml_supported ?? metadata.mlSupported
    const mlSupported = typeof rawMlSupported === "boolean"
      ? rawMlSupported
      : null
    const rawMlStatus = cleanString(metadata.ml_status || metadata.mlStatus)

    return {
      name,
      mlSupported,
      predictionCropName:
        cleanString(
          metadata.prediction_crop_name || metadata.predictionCropName,
        ) || null,
      mlStatus: rawMlStatus || getDefaultMlStatus(mlSupported),
      exclusionReasons: uniqueStrings(
        metadata.exclusion_reasons || metadata.exclusionReasons,
      ),
    }
  })
}

function getDefaultMlStatus(mlSupported) {
  if (mlSupported === true) return "supported"
  if (mlSupported === false) return "statistics_only"
  return "unknown"
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return []

  const uniqueValues = new Map()
  values.forEach((value) => {
    const trimmedValue = cleanString(value)
    const key = normalizeName(trimmedValue)
    if (key && !uniqueValues.has(key)) uniqueValues.set(key, trimmedValue)
  })
  return [...uniqueValues.values()]
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeName(value) {
  return cleanString(value).toLocaleLowerCase("en-MY")
}
