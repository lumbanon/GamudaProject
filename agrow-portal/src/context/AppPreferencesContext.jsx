import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  AppPreferencesActionsContext,
  AppPreferencesStateContext,
} from './appPreferences'

export function AppPreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState({})

  const setAppPreference = useCallback((key, nextValue, initialValue) => {
    setPreferences((currentPreferences) => {
      const hasStoredValue = Object.hasOwn(currentPreferences, key)
      const currentValue = hasStoredValue
        ? currentPreferences[key]
        : initialValue
      const resolvedValue =
        typeof nextValue === 'function'
          ? nextValue(currentValue)
          : nextValue

      if (hasStoredValue && Object.is(currentValue, resolvedValue)) {
        return currentPreferences
      }

      return {
        ...currentPreferences,
        [key]: resolvedValue,
      }
    })
  }, [])

  const resetAppPreference = useCallback((key) => {
    setPreferences((currentPreferences) => {
      if (!Object.hasOwn(currentPreferences, key)) return currentPreferences

      const nextPreferences = { ...currentPreferences }
      delete nextPreferences[key]
      return nextPreferences
    })
  }, [])

  const resetAppPreferences = useCallback(() => {
    setPreferences({})
  }, [])

  const actionsValue = useMemo(
    () => ({
      resetAppPreference,
      resetAppPreferences,
      setAppPreference,
    }),
    [resetAppPreference, resetAppPreferences, setAppPreference],
  )

  return (
    <AppPreferencesActionsContext.Provider value={actionsValue}>
      <AppPreferencesStateContext.Provider value={preferences}>
        {children}
      </AppPreferencesStateContext.Provider>
    </AppPreferencesActionsContext.Provider>
  )
}
