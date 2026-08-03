export function buildHistoryPayload({
  district,
  name,
  polygon,
  result,
  selectedCrop,
  capturedAt = new Date().toISOString(),
}) {
  const suitability = result.suitability || {}
  const insight = result.genai_insight || {}
  const environment = result.features || result.matched_environment || {}
  const estimate = result.return_estimate || null
  const risks =
    insight.potential_risks ||
    suitability.risk_warnings ||
    suitability.limitations ||
    []
  const strengths = insight.key_strengths || suitability.strengths || []
  const actions =
    insight.recommended_actions ||
    result.recommendations ||
    suitability.recommendations ||
    []
  const missingData = insight.missing_data || environment.missing_fields || []

  return {
    name: name.trim() || null,
    boundary: polygon,
    district: result.district || district || null,
    selected_crop: result.crop || selectedCrop || null,
    suitability_score:
      result.suitability_score ?? suitability.score ?? null,
    confidence_level:
      insight.confidence_level || suitability.confidence || null,
    environmental_data: environment,
    forest_reserve_result: {
      allowed: result.allowed !== false,
      reserved_forest: Boolean(result.reserved_forest),
      blocked_reason: result.blocked_reason || null,
      reserved_overlap_m2: result.reserved_overlap_m2 || 0,
      warning: result.forest_reserve_check_warning || null,
    },
    land_cover_result: {
      land_cover: environment.land_cover || null,
      raster_land_cover: environment.raster_land_cover || null,
      source: environment.land_cover_source || environment.data_source || null,
      satellite_building_analysis: result.satellite_building_analysis || null,
    },
    prediction_result: result,
    yield_estimate: estimate
      ? {
          estimated_yield_tonnes: estimate.estimated_yield_tonnes,
          confidence: estimate.confidence,
          basis: estimate.basis,
        }
      : null,
    revenue_estimate: estimate
      ? {
          estimated_revenue_myr: estimate.estimated_revenue_myr,
          confidence: estimate.confidence,
          basis: estimate.basis,
        }
      : null,
    risks,
    strengths,
    missing_data: missingData,
    recommended_actions: actions,
    gemini_insights: result.genai_insight || null,
    analysis_status: "completed",
    dataset_snapshot: {
      captured_at: capturedAt,
      environmental_data_source: environment.data_source || null,
      environmental_data_note: environment.data_source_note || null,
      confidence_matrix: result.confidence_matrix || {},
      model_confidence_pct: suitability.model_confidence_pct ?? null,
      gemini_model: result.genai_insight?.model || null,
      satellite_model: result.satellite_building_analysis?.model || null,
    },
    analysis_version: "agrow_prediction_v1",
    settings: {
      crop: result.crop || selectedCrop || null,
      district: result.district || district || null,
    },
  }
}
