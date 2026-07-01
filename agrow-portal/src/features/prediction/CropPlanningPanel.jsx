import {
  buildFeatureRows,
  formatCurrency,
  formatHectares,
  formatNumber,
  formatPlaceholderFields,
  getSuitabilityTone,
  SUPPORTED_CROPS,
} from "./predictionUtils"

export default function CropPlanningPanel({
  areaHectares,
  canAnalyze,
  error,
  isLoading,
  onAnalyze,
  onClearArea,
  onCropChange,
  result,
  selectedCrop,
  hasPolygon,
}) {
  const cropSelected = Boolean(selectedCrop)
  const ready = canAnalyze && !isLoading

  return (
    <aside className="crop-planning-panel">
      <section className="planning-control-card">
        <div className="planning-progress" aria-label="Planning progress">
          <ProgressItem complete={hasPolygon} label="Area" />
          <ProgressItem complete={cropSelected} label="Crop" />
          <ProgressItem complete={ready} label="Ready" />
        </div>

        <div className="planning-control-grid">
          <div className="control-field">
            <span>1. Farm area</span>
            <strong>{formatHectares(areaHectares)}</strong>
            <small>{hasPolygon ? "Boundary captured" : "Draw on the map"}</small>
          </div>

          <label className="control-field crop-control-field" htmlFor="planning-crop">
            <span>2. Crop</span>
            <select id="planning-crop" value={selectedCrop} onChange={(event) => onCropChange(event.target.value)}>
              <option value="">Select crop</option>
              {SUPPORTED_CROPS.map((crop) => (
                <option value={crop} key={crop}>
                  {crop}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="planning-action-row">
          <button className="analyze-area-button" type="button" onClick={onAnalyze} disabled={!canAnalyze || isLoading}>
            {isLoading ? "Analyzing..." : "Analyze Farm Area"}
          </button>
          <button className="clear-area-button" type="button" onClick={onClearArea} disabled={!hasPolygon && !areaHectares}>
            Clear
          </button>
        </div>
      </section>

      <section className="farm-insight-panel">
        <div className="farm-insight-heading">
          <span>4. AI Farm Insight</span>
          {result?.features?.data_source && (
            <strong className={`source-pill source-${result.features.data_source}`}>{result.features.data_source}</strong>
          )}
        </div>

        {!result && !isLoading && !error && (
          <div className="planning-empty-state">Draw an area and choose a crop to generate AI farm insights.</div>
        )}

        {isLoading && (
          <div className="planning-loading-state">Analyzing soil, climate, terrain and crop requirements...</div>
        )}

        {error && <div className="planning-error-state">{error}</div>}

        {result && <PlanningResults result={result} />}
      </section>
    </aside>
  )
}

function PlanningResults({ result }) {
  const suitability = result.suitability || {}
  const features = result.features || {}
  const estimate = result.return_estimate || {}
  const plantingWindow = result.planting_window || {}
  const score = Number(suitability.score || 0)
  const tone = getSuitabilityTone(suitability.status)
  const placeholderFields = formatPlaceholderFields(features.placeholder_fields)
  const sourceNotes = [
    placeholderFields ? `Placeholder layers: ${placeholderFields}. ${features.data_source_note || ""}` : "",
    estimate.basis || "",
  ].filter(Boolean)

  return (
    <div className="planning-results">
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

      <div className="result-card-grid">
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
        <ResultCard
          label="Risk alert"
          value={suitability.risk_level || "N/A"}
          detail={(suitability.risk_warnings || [])[0] || "No major rule-based risk detected"}
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

      <details className="planning-accordion">
        <summary>Environmental layers</summary>
        <div className="feature-grid">
          {buildFeatureRows(features).map((feature) => (
            <div className="feature-tile" key={feature.label}>
              <span>{feature.label}</span>
              <strong>{feature.value}</strong>
            </div>
          ))}
        </div>
      </details>

      {sourceNotes.length > 0 && (
        <details className="planning-accordion">
          <summary>Data confidence</summary>
          <div className="source-note-list">
            {sourceNotes.map((note) => (
              <p className="source-note" key={note}>
                {note}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function ProgressItem({ complete, label }) {
  return (
    <div className={`progress-item ${complete ? "complete" : ""}`}>
      <span aria-hidden="true" />
      <strong>{label}</strong>
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
