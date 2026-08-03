import { useEffect, useState } from "react"
import { EnvironmentDataPanel } from "../analysis/CropPlanningPanel"
import PredictionInsightsPanel from "../analysis/PredictionInsightsPanel"
import {
  fetchAnalysisHistoryRecord,
  restoreAnalysisHistory,
} from "./historyApi"
import HistoryBoundaryMap from "./HistoryBoundaryMap"
import "./history-view.css"

export default function PredictionHistoryDetail({
  historyId,
  onBack,
  onRestore,
}) {
  const [loadState, setLoadState] = useState({
    historyId: null,
    record: null,
    error: "",
  })
  const [isRestoring, setIsRestoring] = useState(false)
  const [actionError, setActionError] = useState("")

  useEffect(() => {
    let isActive = true

    fetchAnalysisHistoryRecord(historyId)
      .then((record) => {
        if (isActive) setLoadState({ historyId, record, error: "" })
      })
      .catch((requestError) => {
        if (!isActive) return
        setLoadState({
          historyId,
          record: null,
          error:
            requestError.message || "Analysis history record was not found.",
        })
      })

    return () => {
      isActive = false
    }
  }, [historyId])

  async function runNewAnalysis() {
    setIsRestoring(true)
    setActionError("")
    try {
      const restoration = await restoreAnalysisHistory(historyId)
      onRestore(restoration)
    } catch (requestError) {
      setActionError(requestError.message || "Unable to restore this boundary.")
      setIsRestoring(false)
    }
  }

  if (loadState.historyId !== historyId) {
    return <div className="history-state">Loading historical analysis...</div>
  }

  if (!loadState.record) {
    return (
      <div className="history-state history-error-state">
        <strong>
          {loadState.error || "Analysis history record was not found."}
        </strong>
        <button type="button" onClick={onBack}>
          Back to Prediction History
        </button>
      </div>
    )
  }

  const record = loadState.record
  const historicalPredictionResult = {
    ...(record.prediction_result || {}),
    genai_insight:
      record.gemini_insights ||
      record.prediction_result?.genai_insight ||
      null,
  }

  return (
    <section
      className="prediction-history-detail"
      aria-label="Historical prediction details"
    >
      <button type="button" className="history-back-button" onClick={onBack}>
        ← Back to Prediction History
      </button>

      <section className="historical-banner">
        <strong>Historical data notice</strong>
        <span>
          Saved {formatDate(record.created_at)}. These are the original
          environmental and prediction values and have not been replaced with
          current datasets.
        </span>
      </section>

      <header className="history-detail-heading">
        <div>
          <span className="history-eyebrow">Saved analysis</span>
          <h2>{record.name || "Untitled analysis"}</h2>
          <p>Original analysis date: {formatDate(record.created_at)}</p>
        </div>
        <div className="history-heading-actions">
          <button
            type="button"
            onClick={runNewAnalysis}
            disabled={isRestoring}
          >
            {isRestoring ? "Restoring..." : "Restore / Run New Analysis"}
          </button>
        </div>
      </header>

      {actionError && (
        <p className="history-inline-error">{actionError}</p>
      )}

      <section className="history-summary-grid">
        <HistorySummary
          label="Crop"
          value={record.selected_crop || "Not selected"}
        />
        <HistorySummary
          label="District"
          value={record.district || "Not detected"}
        />
        <HistorySummary
          label="Land area"
          value={`${formatNumber(record.land_area_hectares)} ha`}
        />
        <HistorySummary
          label="Suitability score"
          value={
            record.suitability_score == null
              ? "N/A"
              : `${record.suitability_score}/100`
          }
        />
        <HistorySummary
          label="Confidence"
          value={record.confidence_level || "N/A"}
        />
        <HistorySummary label="Status" value={record.analysis_status} />
      </section>

      <HistoryBoundaryMap boundary={record.boundary} />

      <section
        className="historical-results"
        aria-label="Saved prediction results"
      >
        <PredictionInsightsPanel
          error=""
          isLoading={false}
          result={historicalPredictionResult}
        />
        <EnvironmentDataPanel
          isLoading={false}
          result={{
            ...historicalPredictionResult,
            features: record.environmental_data,
          }}
        />
      </section>

      <section className="history-snapshot-grid">
        <SnapshotList title="Strengths" values={record.strengths} />
        <SnapshotList title="Risks" values={record.risks} />
        <SnapshotList
          title="Recommended actions"
          values={record.recommended_actions}
        />
        <SnapshotList title="Missing data" values={record.missing_data} />
      </section>
    </section>
  )
}

function HistorySummary({ label, value }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function SnapshotList({ title, values }) {
  const items = Array.isArray(values) ? values : []
  return (
    <article>
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((value, index) => (
            <li key={`${title}-${index}`}>{String(value)}</li>
          ))}
        </ul>
      ) : (
        <p>None recorded.</p>
      )}
    </article>
  )
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number)
    ? number.toLocaleString("en-MY", { maximumFractionDigits: 2 })
    : "N/A"
}
