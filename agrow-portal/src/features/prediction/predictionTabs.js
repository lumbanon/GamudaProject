export const DEFAULT_PREDICTION_TAB = 'new'

export const PREDICTION_TABS = Object.freeze([
  { id: 'new', label: 'New Analysis' },
  { id: 'history', label: 'Prediction History' },
])

export function nextTabIndex(key, currentIndex, tabCount) {
  if (tabCount <= 0) return currentIndex
  if (key === 'Home') return 0
  if (key === 'End') return tabCount - 1
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount
  return currentIndex
}
