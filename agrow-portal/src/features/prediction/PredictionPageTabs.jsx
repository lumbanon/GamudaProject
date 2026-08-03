import { useRef } from "react"
import { PREDICTION_TABS, nextTabIndex } from "./predictionTabs"

export default function PredictionPageTabs({ activeTab, onTabChange }) {
  const tabRefs = useRef([])

  function handleKeyDown(event, currentIndex) {
    const nextIndex = nextTabIndex(
      event.key,
      currentIndex,
      PREDICTION_TABS.length,
    )
    if (nextIndex === currentIndex && !["Home", "End"].includes(event.key)) {
      return
    }

    event.preventDefault()
    const nextTab = PREDICTION_TABS[nextIndex]
    onTabChange(nextTab.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      className="prediction-page-tabs"
      role="tablist"
      aria-label="Farm Area Analyzer sections"
    >
      {PREDICTION_TABS.map((tab, index) => {
        const isActive = activeTab === tab.id
        return (
          <button
            aria-controls={`prediction-panel-${tab.id}`}
            aria-selected={isActive}
            className={isActive ? "is-active" : ""}
            id={`prediction-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
