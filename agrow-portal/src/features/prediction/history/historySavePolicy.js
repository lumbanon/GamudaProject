const BUILT_AREA_TERMS = [
  "built",
  "urban",
  "developed",
  "settlement",
  "residential",
  "commercial",
  "industrial",
]

export function getHistorySaveBlockReason(result) {
  if (!result) return ""
  if (result.allowed === false || result.reserved_forest === true) {
    return "This analysis cannot be saved because the selected area is inside a forest reserve."
  }

  const satellite = result.satellite_building_analysis || {}
  const environment = result.features || result.matched_environment || {}
  const landCover = String(environment.land_cover || "").trim().toLowerCase()
  const isMateriallyBuiltArea =
    satellite.is_built_up === true ||
    satellite.land_cover_override_recommended === true ||
    BUILT_AREA_TERMS.some((term) => landCover.includes(term))

  if (isMateriallyBuiltArea && !hasUsableGeminiInsight(result.genai_insight)) {
    return "This analysis cannot be saved because a materially built-up area was detected and no Gemini insight is available."
  }
  return ""
}

export function hasUsableGeminiInsight(insight) {
  if (!insight || typeof insight !== "object" || insight.fallback_used === true) {
    return false
  }

  return [
    insight.crop_suitability_summary,
    insight.key_strengths,
    insight.potential_risks,
    insight.recommended_actions,
  ].some(hasMeaningfulValue)
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.some(hasMeaningfulValue)
  return typeof value === "string" && Boolean(value.trim())
}
