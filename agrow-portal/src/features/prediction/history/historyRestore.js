import { APP_PREFERENCE_KEYS } from "../../../context/appPreferences.js"

export function restoreHistoryIntoPrediction(actions, restoration) {
  actions.setAppPreference(
    APP_PREFERENCE_KEYS.predictionPolygon,
    restoration.boundary,
    null,
  )
  actions.setAppPreference(
    APP_PREFERENCE_KEYS.predictionCrop,
    restoration.selected_crop || "",
    "",
  )
  actions.setAppPreference(
    APP_PREFERENCE_KEYS.predictionDistrict,
    restoration.district || "",
    "",
  )
  actions.setAppPreference(APP_PREFERENCE_KEYS.predictionAnalysis, null, null)
  actions.setAppPreference(APP_PREFERENCE_KEYS.predictionForestReserve, null, null)
  actions.setAppPreference(
    APP_PREFERENCE_KEYS.predictionClearVersion,
    (version) => Number(version || 0) + 1,
    0,
  )
}
