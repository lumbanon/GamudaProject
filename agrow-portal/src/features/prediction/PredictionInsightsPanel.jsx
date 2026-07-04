import warningIcon from "../../assets/prediction/warning.svg"
import PredictionAssetIcon from "./PredictionAssetIcon"
import {
  formatCurrency,
  formatHectares,
  formatNumber,
  getSuitabilityTone,
} from "./predictionUtils"

export default function PredictionInsightsPanel({ error, isLoading, result }) {
  const isBlocked = Boolean(result?.allowed === false || result?.blocked_reason === "reserved_forest")

  return (
    <section className="farm-insight-panel map-insight-panel">
      <div className="farm-insight-heading">
        <span>4. AI Farm Insight</span>
        {result?.features?.data_source && (
          <strong className={`source-pill source-${result.features.data_source}`}>{result.features.data_source}</strong>
        )}
      </div>

      {!result && !isLoading && !error && (
        <div className="planning-empty-state">Draw an area or choose a district, then choose a crop to generate AI farm insights.</div>
      )}

      {isLoading && <div className="planning-loading-state">Analyzing soil, climate, terrain and crop requirements...</div>}

      {error && <div className="planning-error-state">{error}</div>}

      {isBlocked && <ReservedForestWarning result={result} />}

      {result && !isBlocked && <PlanningResults result={result} />}
    </section>
  )
}

function ReservedForestWarning({ result }) {
  const message = result?.message || "Selected area is inside a reserved forest. You are not allowed to plant here."
  const overlap = Number(result?.reserved_overlap_m2 || 0)

  return (
    <article className="reserved-forest-warning" role="alert">
      <span className="reserved-warning-icon" aria-hidden="true">
        <PredictionAssetIcon src={warningIcon} />
      </span>
      <div>
        <strong>Reserved Forest Area Detected</strong>
        <p>{message}</p>
        <small>Please select another area outside protected land.</small>
        {overlap > 0 && <small>Estimated overlap: {formatNumber(overlap, 2)} m2.</small>}
      </div>
    </article>
  )
}

function PlanningResults({ result }) {
  const suitability = result.suitability || {}
  const estimate = result.return_estimate || {}
  const plantingWindow = result.planting_window || {}
  const score = Number(suitability.score || 0)
  const tone = getSuitabilityTone(suitability.status)

  return (
    <div className="planning-results planning-results-wide">
      <div className="result-card-grid summary-result-grid">
        <article className={`result-card score-result-card tone-${tone}`}>
          <div className="score-ring" style={{ "--score": `${Math.max(0, Math.min(100, score))}%` }}>
            <strong>{score}</strong>
            <span>/100</span>
          </div>
          <div>
            <span>Suitability score</span>
            <strong>{suitability.status || "Pending"}</strong>
            <p>Risk level: {suitability.risk_level || "N/A"}</p>
          </div>
        </article>

        <ResultCard label="Area size" value={formatHectares(result.area_hectares)} />
        <ResultCard
          label="Planting window"
          value={(plantingWindow.best_months || []).join(", ") || "N/A"}
          detail={plantingWindow.reason}
        />
        <ResultCard
          label="Estimated return"
          value={formatCurrency(estimate.estimated_revenue_myr)}
          detail={`${formatNumber(estimate.estimated_yield_tonnes, 2)} tonnes, ${estimate.confidence || "Low confidence"}`}
        />
      </div>

      <article className="insight-summary-card">
        <span>AI-style recommendation summary</span>
        <p>{result.ai_insight}</p>
      </article>

      <div className="quick-insight-grid">
        <InsightPreview title="Strengths" items={suitability.strengths} />
        <InsightPreview title="Watch points" items={suitability.limitations} />
      </div>

      <details className="planning-accordion">
        <summary>Recommendations</summary>
        <InsightList items={suitability.recommendations} />
      </details>
    </div>
  )
}

function ResultCard({ label, value, detail }) {
  return (
    <article className="result-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <p>{detail}</p>}
    </article>
  )
}

function InsightPreview({ title, items = [] }) {
  return (
    <div className="insight-preview">
      <span>{title}</span>
      {(items.length ? items : ["No item returned"]).slice(0, 3).map((item) => (
        <strong key={item}>{item}</strong>
      ))}
    </div>
  )
}

function InsightList({ items = [] }) {
  return (
    <div className="insight-list">
      <ul>
        {(items.length ? items : ["No item returned"]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
