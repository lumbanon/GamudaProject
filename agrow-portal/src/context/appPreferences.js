import {
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react'

export const AppPreferencesStateContext = createContext(null)
export const AppPreferencesActionsContext = createContext(null)

export const APP_PREFERENCE_KEYS = Object.freeze({
  dashboardActiveCrop: 'dashboard.activeCrop',
  dashboardDistrict: 'dashboard.selectedDistrict',
  dashboardDistrictMatrix: 'dashboard.districtMatrix',
  dashboardPredictions: 'dashboard.predictions',
  dashboardDistrictSuitability: 'dashboard.allDistrictsSuitability',
  dashboardShowModeling: 'dashboard.showModeling',
  dashboardSimulationParameters: 'dashboard.simulationParameters',
  heatmapDistrict: 'heatmap.selectedDistrict',
  heatmapCrop: 'heatmap.selectedCrop',
  heatmapDistrictMatrix: 'heatmap.districtMatrix',
  heatmapDisplayedCrop: 'heatmap.displayedCrop',
  predictionPolygon: 'prediction.polygon',
  predictionCrop: 'prediction.selectedCrop',
  predictionDistrict: 'prediction.selectedDistrict',
  predictionAnalysis: 'prediction.analysisResult',
  predictionForestReserve: 'prediction.forestReserveResult',
  predictionClearVersion: 'prediction.clearVersion',
  statisticsFilters: 'statistics.filters',
  profileUser: 'profile.user',
  profileFullName: 'profile.fullName',
  profileEmail: 'profile.email',
  profileIsEditing: 'profile.isEditing',
})

export function useAppPreference(key, initialValue) {
  const preferences = useContext(AppPreferencesStateContext)
  const actions = useAppPreferences()
  const [initialPreferenceValue] = useState(() =>
    typeof initialValue === 'function' ? initialValue() : initialValue,
  )

  if (!preferences) {
    throw new Error(
      'App preference hooks must be used within AppPreferencesProvider.',
    )
  }

  const hasStoredValue = Object.hasOwn(preferences, key)
  const value = hasStoredValue
    ? preferences[key]
    : initialPreferenceValue

  const setValue = useCallback(
    (nextValue) => {
      actions.setAppPreference(key, nextValue, initialPreferenceValue)
    },
    [actions, initialPreferenceValue, key],
  )

  const resetValue = useCallback(() => {
    actions.resetAppPreference(key)
  }, [actions, key])

  return [value, setValue, resetValue]
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesActionsContext)

  if (!context) {
    throw new Error(
      'App preference hooks must be used within AppPreferencesProvider.',
    )
  }

  return context
}
