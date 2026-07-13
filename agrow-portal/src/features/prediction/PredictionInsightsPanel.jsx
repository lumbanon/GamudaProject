import warningIcon from "../../assets/prediction/warning.svg?raw";
import PredictionAssetIcon from "./PredictionAssetIcon";
import {
  formatFarmerDataSource,
  formatFarmerDataSourceLabel,
  formatFarmerFacingText,
  formatFarmerReturnBasis,
  formatFarmerReturnConfidence,
  formatCurrency,
  formatHectares,
  formatNumber,
  getSuitabilityTone,
} from "./predictionUtils";

const BUILT_AREA_TERMS = [
  "built",
  "urban",
  "developed",
  "settlement",
  "residential",
  "commercial",
  "industrial",
];

export default function PredictionInsightsPanel({ error, isLoading, result }) {
  const isBlocked = Boolean(
    result?.allowed === false || result?.blocked_reason === "reserved_forest",
  );
  const genAiInsight =
    result && !isBlocked
      ? normalizeGenAiInsight(result.genai_insight, result.ai_insight)
      : null;
  const isBuiltArea = Boolean(
    result && !isBlocked && detectBuiltArea(result, genAiInsight),
  );
  const sourceValue = result?.features?.data_source;

  return (
    <section className="farm-insight-panel map-insight-panel">
      <div className="farm-insight-heading">
        <span>4. AI Farm Insight</span>
        {sourceValue && (
          <strong className={`source-pill source-${sourceValue}`}>
            {formatFarmerDataSourceLabel(sourceValue)}
          </strong>
        )}
      </div>

      {!result && !isLoading && !error && (
        <div className="planning-empty-state">
          Draw an area or choose a district, then choose a crop to generate AI
          farm insights.
        </div>
      )}

      {isLoading && (
        <div className="planning-loading-state">
          Analyzing soil, climate, terrain and crop requirements...
        </div>
      )}

      {error && <div className="planning-error-state">{error}</div>}

      {isBlocked && <ReservedForestWarning result={result} />}

      {isBuiltArea && (
        <BuiltUpAreaWarning result={result} insight={genAiInsight} />
      )}

      {result && !isBlocked && !isBuiltArea && (
        <PlanningResults result={result} />
      )}
    </section>
  );
}

function ReservedForestWarning({ result }) {
  const message =
    result?.message ||
    "Selected area is inside a reserved forest. You are not allowed to plant here.";
  const overlap = Number(result?.reserved_overlap_m2 || 0);

  return (
    <article className="reserved-forest-warning" role="alert">
      <span className="reserved-warning-icon" aria-hidden="true">
        <PredictionAssetIcon src={warningIcon} />
      </span>
      <div>
        <strong>Reserved Forest Area Detected</strong>
        <p>{message}</p>
        <small>Please select another area outside protected land.</small>
        {overlap > 0 && (
          <small>Estimated overlap: {formatNumber(overlap, 2)} m2.</small>
        )}
      </div>
    </article>
  );
}

function BuiltUpAreaWarning({ result, insight }) {
  const summary = stringifyInsight(
    insight?.crop_suitability_summary || result?.ai_insight,
  );
  const message = hasBuiltAreaTerm(summary)
    ? summary
    : "Selected location is built-up/developed land and is not recommended for crop planting.";
  const satelliteAnalysis = result?.satellite_building_analysis;

  return (
    <article className="reserved-forest-warning" role="alert">
      <span className="reserved-warning-icon" aria-hidden="true">
        <PredictionAssetIcon src={warningIcon} />
      </span>
      <div>
        <strong>Built-Up Area Detected</strong>
        <p>{message}</p>
        <small>Please select another agricultural or undeveloped site.</small>
        {satelliteAnalysis?.status === "analyzed" && (
          <small>
            Gemini satellite check: {satelliteAnalysis.confidence || "unknown"} confidence,
            {" "}{formatNumber(satelliteAnalysis.estimated_built_up_percent, 1)}% estimated developed coverage.
          </small>
        )}
      </div>
    </article>
  );
}

function PlanningResults({ result }) {
  const suitability = result.suitability || {};
  const estimate = result.return_estimate || {};
  const score = Number(suitability.score || 0);
  const tone = getSuitabilityTone(suitability.status);
  const genAiInsight = normalizeGenAiInsight(
    result.genai_insight,
    result.ai_insight,
  );
  const isBuiltArea = detectBuiltArea(result, genAiInsight);
  const reportData = buildPredictionReportData(
    result,
    genAiInsight,
    isBuiltArea,
  );

  return (
    <div className="planning-results planning-results-wide">
      <div className="result-card-grid summary-result-grid">
        <article className={`result-card score-result-card tone-${tone}`}>
          <div
            className="score-ring"
            style={{ "--score": `${Math.max(0, Math.min(100, score))}%` }}
          >
            <strong>{score}</strong>
            <span>/100</span>
          </div>
          <div>
            <span className="ai-insight-card-label">Suitability score</span>
            <strong>{suitability.status || "Pending"}</strong>
            <p>Risk level: {suitability.risk_level || "N/A"}</p>
          </div>
        </article>

        <ResultCard
          label="Area size"
          value={formatHectares(result.area_hectares)}
        />
        <ResultCard
          label="Planting window"
          value={reportData.plantingWindow.displayText}
          fullValue={reportData.plantingWindow.fullText}
          detail={reportData.plantingReason.displayText}
          fullDetail={reportData.plantingReason.fullText}
        />
        <ResultCard
          label="Estimated return"
          value={formatCurrency(estimate.estimated_revenue_myr)}
          detail={reportData.returnPreview.displayText}
          fullDetail={reportData.returnPreview.fullText}
        />
      </div>

      <article className="insight-summary-card">
        <span className="ai-recommendation-heading">
          AI recommendation summary
        </span>
        {genAiInsight ? (
          <GenAiInsightSummary
            insight={genAiInsight}
            hideConfidence={isBuiltArea}
          />
        ) : (
          <p className="ai-recommendation-content">{result.ai_insight}</p>
        )}
      </article>

      <div className="quick-insight-grid genai-section-grid">
        <InsightPreview
          title="Key strengths"
          items={genAiInsight?.key_strengths || suitability.strengths}
        />
        <InsightPreview
          title="Potential risks"
          items={genAiInsight?.potential_risks || suitability.limitations}
        />
        <InsightPreview
          title="Missing data"
          items={genAiInsight?.missing_data}
        />
      </div>

      <article className="recommendation-panel">
        <span className="recommended-actions-heading">
          Recommended actions
        </span>
        <InsightList
          className="recommended-actions-list"
          items={
            genAiInsight?.recommended_actions || suitability.recommendations
          }
        />
      </article>

      <div className="prediction-report-actions">
        <button
          type="button"
          className="download-pdf-button"
          onClick={() => printPredictionReport(result, genAiInsight)}
        >
          Download PDF
        </button>
      </div>
    </div>
  );
}

function GenAiInsightSummary({ insight, hideConfidence = false }) {
  const confidence = hideConfidence
    ? null
    : normalizeConfidence(insight.confidence_level);

  return (
    <div className="genai-summary-content">
      <p className="ai-recommendation-content">
        {insight.crop_suitability_summary}
      </p>
      {!hideConfidence && (
        <div className="genai-confidence-row">
          <span className="ai-confidence-label">Confidence level</span>
          <strong
            className={`confidence-pill confidence-${confidence.toLowerCase()}`}
          >
            {confidence}
          </strong>
        </div>
      )}
      {insight.fallback_used && (
        <small className="genai-fallback-note">
          {insight.fallback_reason ||
            "Using rule-based fallback because Gemini insight is unavailable."}
        </small>
      )}
    </div>
  );
}

function ResultCard({ label, value, detail, fullValue, fullDetail }) {
  return (
    <article className="result-card">
      <span className="ai-insight-card-label">{label}</span>
      <strong title={fullValue || value}>{value}</strong>
      {detail && (
        <p className="card-preview-text" title={fullDetail || detail}>
          {detail}
        </p>
      )}
    </article>
  );
}

function InsightPreview({ title, items = [] }) {
  return (
    <div className="insight-preview">
      <span className="insight-preview-heading">{title}</span>
      {(items.length ? items : ["No item returned"]).slice(0, 3).map((item) => (
        <strong className="insight-preview-item" key={item}>
          {item}
        </strong>
      ))}
    </div>
  );
}

function InsightList({ className = "", items = [] }) {
  return (
    <div className={`insight-list ${className}`.trim()}>
      <ul>
        {(items.length ? items : ["No item returned"]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function printPredictionReport(result, genAiInsight) {
  const iframe = document.createElement("iframe");
  iframe.title = "Agrow AI prediction PDF report";
  iframe.className = "prediction-print-frame";
  document.body.appendChild(iframe);

  const printWindow = iframe.contentWindow;
  const printDocument = iframe.contentDocument || printWindow?.document;

  if (!printWindow || !printDocument) {
    iframe.remove();
    window.print();
    return;
  }

  printDocument.open();
  printDocument.write(buildPredictionReportHtml(result, genAiInsight));
  printDocument.close();

  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    window.setTimeout(() => iframe.remove(), 1000);
  }, 250);
}

function buildPredictionReportHtml(result, genAiInsight) {
  const reportData = buildPredictionReportData(
    result,
    genAiInsight,
    detectBuiltArea(result, genAiInsight),
  );
  const { suitability, estimate, plantingWindow, features } = reportData;
  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Agrow AI Prediction Report</title>
        <style>
          body {
            margin: 0;
            padding: 32px;
            color: #24342a;
            font-family: Arial, sans-serif;
            line-height: 1.45;
          }
          h1, h2, p { margin-top: 0; }
          h1 { font-size: 28px; margin-bottom: 6px; }
          h2 {
            margin: 24px 0 10px;
            color: #1f5f36;
            font-size: 15px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .meta {
            margin-bottom: 24px;
            color: #66746c;
            font-size: 12px;
          }
          .summary {
            padding: 16px;
            border: 1px solid #dce8df;
            border-radius: 10px;
            background: #f7fbf7;
          }
          .report-section,
          .report-card {
            break-inside: avoid;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .report-card {
            padding: 12px;
            border: 1px solid #e2ebe4;
            border-radius: 8px;
          }
          .report-card span {
            display: block;
            color: #66746c;
            font-size: 11px;
            font-weight: 400; /* PDF report card labels: Crop, District, Return basis, Data source */
            text-transform: uppercase;
          }
          .report-card p {
            display: block;
            margin-top: 5px;
            font-size: 16px;
            color: #24342a;
            font-weight: 700; /* PDF report card values and explanations */
          }
          ul { margin: 0; padding-left: 20px; }
          li { margin-bottom: 5px; }
          .report-card,
          .report-card p,
          .report-section,
          .report-section p {
            white-space: normal;
            overflow: visible;
            text-overflow: unset;
            display: block;
            -webkit-line-clamp: unset;
            height: auto;
            max-height: none;
          }
        </style>
      </head>
      <body>
        <h1>Agrow AI Prediction Report</h1>
        <p class="meta">Generated ${escapeHtml(generatedAt)}</p>

        <section class="summary report-section">
          <h2>AI Recommendation Summary</h2>
          <p>${escapeHtml(reportData.aiSummary.fullText)}</p>
        </section>

        <section class="report-section">
          <h2>Suitability</h2>
          <div class="grid">
            ${reportBox("Crop", result.crop || "N/A")}
            ${reportBox("District", result.district || "Selected map area")}
            ${reportBox("Suitability score", `${formatNumber(suitability.score, 0)}/100`)}
            ${reportBox("Status", suitability.status || "N/A")}
            ${reportBox("Risk level", suitability.risk_level || "N/A")}
            ${reportBox("Area", formatHectares(result.area_hectares))}
          </div>
        </section>

        <section class="report-section">
          <h2>Planting And Return</h2>
          <div class="grid">
            ${reportBox("Planting window", plantingWindow.fullText)}
            ${reportBox("Planting reason", reportData.plantingReason.fullText)}
            ${reportBox("Estimated revenue", formatCurrency(estimate.estimated_revenue_myr))}
            ${reportBox("Estimated yield", formatYieldTonnes(estimate.estimated_yield_tonnes))}
            ${reportBox("Estimated return explanation", reportData.returnExplanation.fullText)}
            ${reportBox("Return basis", reportData.returnBasis.fullText)}
          </div>
        </section>

        <section class="report-section">
          <h2>Key Strengths</h2>
          ${reportList(reportData.keyStrengths.fullItems)}
        </section>

        <section class="report-section">
          <h2>Potential Risks</h2>
          ${reportList(reportData.potentialRisks.fullItems)}
        </section>

        <section class="report-section">
          <h2>Recommended Actions</h2>
          ${reportList(reportData.recommendedActions.fullItems)}
        </section>

        <section class="report-section">
          <h2>Missing Data</h2>
          ${reportList(reportData.missingData.fullItems)}
        </section>

        <section class="report-section">
          <h2>Environmental Values</h2>
          <div class="grid">
            ${reportBox("Rainfall", `${formatNumber(features.rainfall_mm, 2)} mm`)}
            ${reportBox("Soil pH", formatNumber(features.soil_ph, 2))}
            ${reportBox("Soil depth", `${formatNumber(features.soil_depth_cm, 2)} cm`)}
            ${reportBox("Elevation", `${formatNumber(features.elevation_m || features.dem_m, 2)} m`)}
            ${reportBox("Slope", `${formatNumber(features.slope_pct, 2)}%`)}
            ${reportBox("Solar radiation", formatNumber(features.solar_radiation, 2))}
            ${reportBox("Root zone moisture", formatNumber(features.root_zone_moisture, 2))}
            ${reportBox("Land cover", formatLandCoverValue(features))}
            ${reportBox("Data source", reportData.dataSource.fullText)}
          </div>
        </section>
      </body>
    </html>`;
}

function buildPredictionReportData(result, genAiInsight, isBuiltArea = false) {
  const suitability = result.suitability || {};
  const estimate = result.return_estimate || {};
  const rawPlantingWindow = result.planting_window || {};
  const features = result.features || result.matched_environment || {};
  const plantingWindowText = listText(rawPlantingWindow.best_months) || "N/A";
  const plantingReasonText =
    stringifyInsight(rawPlantingWindow.reason) || "N/A";
  const estimatedYieldText = formatYieldTonnes(estimate.estimated_yield_tonnes);
  const returnConfidenceText = formatFarmerReturnConfidence(
    estimate.confidence,
  );
  const returnBasisText = formatFarmerReturnBasis(estimate.basis);
  const dataSourceText = formatFarmerDataSource(
    features.data_source || features.data_source_note,
  );
  const builtAreaReturnText =
    "Not applicable because the selected location is built-up/developed land.";
  const returnPreviewText = isBuiltArea
    ? builtAreaReturnText
    : [estimatedYieldText, returnConfidenceText]
        .filter((item) => item && item !== "N/A")
        .join(", ") || "N/A";
  const returnExplanationText = isBuiltArea
    ? builtAreaReturnText
    : [returnConfidenceText, returnBasisText]
        .filter((item) => item && item !== "N/A")
        .join(" Basis: ") || "N/A";
  const returnBasisReportText = isBuiltArea
    ? builtAreaReturnText
    : returnBasisText;

  return {
    suitability,
    estimate,
    features,
    plantingWindow: textPair(plantingWindowText, 80),
    plantingReason: textPair(plantingReasonText, 96),
    returnPreview: textPair(returnPreviewText, 96),
    returnExplanation: textPair(returnExplanationText),
    returnBasis: textPair(returnBasisReportText),
    dataSource: textPair(dataSourceText),
    aiSummary: textPair(
      genAiInsight?.crop_suitability_summary ||
        result.ai_insight ||
        "No summary returned.",
    ),
    keyStrengths: listPair(
      genAiInsight?.key_strengths || suitability.strengths,
    ),
    potentialRisks: listPair(
      genAiInsight?.potential_risks || suitability.limitations,
    ),
    recommendedActions: listPair(
      genAiInsight?.recommended_actions || suitability.recommendations,
    ),
    missingData: listPair(genAiInsight?.missing_data),
  };
}

function textPair(value, previewLimit = null) {
  const fullText = formatFarmerFacingText(value) || "N/A";
  return {
    fullText,
    displayText: previewLimit ? shortenText(fullText, previewLimit) : fullText,
  };
}

function listPair(items) {
  const fullItems = normalizeReportList(items);
  return {
    fullItems,
    displayItems: fullItems.map((item) => shortenText(item, 96)),
  };
}

function normalizeReportList(items) {
  const values = Array.isArray(items) ? items : items ? [items] : [];
  return values.map((item) => formatFarmerFacingText(item)).filter(Boolean);
}

function listText(items) {
  return normalizeReportList(items).join(", ");
}

function shortenText(value, maxLength) {
  const text = stringifyInsight(value);
  if (!maxLength || text.length <= maxLength) return text;

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatYieldTonnes(value) {
  const formatted = formatNumber(value, 2);
  return formatted === "N/A" ? formatted : `${formatted} tonnes`;
}

function formatLandCoverValue(features = {}) {
  const text = stringifyInsight(
    features.land_cover ||
      features.land_cover_class ||
      features.land_cover_label ||
      features.landcover ||
      features.land_use,
  );

  if (!text) return "N/A";

  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reportBox(label, value) {
  return `<div class="report-card"><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`;
}

function reportList(items = []) {
  const values = Array.isArray(items) ? items : items ? [items] : [];
  const listItems = (values.length ? values : ["No item returned."])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  return `<ul>${listItems}</ul>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeGenAiInsight(raw, fallbackSummary) {
  if (!raw && !fallbackSummary) return null;

  return {
    crop_suitability_summary: formatFarmerFacingText(
      raw?.crop_suitability_summary ||
        fallbackSummary ||
        "No insight returned.",
    ),
    key_strengths: cleanInsightList(raw?.key_strengths),
    potential_risks: cleanInsightList(raw?.potential_risks),
    recommended_actions: cleanInsightList(raw?.recommended_actions),
    confidence_level: normalizeConfidence(raw?.confidence_level),
    missing_data: cleanInsightList(raw?.missing_data, [
      "No missing data returned.",
    ]),
    fallback_used: Boolean(raw?.fallback_used),
    fallback_reason: stringifyInsight(raw?.fallback_reason),
  };
}

function cleanInsightList(items, fallback = null) {
  const values = Array.isArray(items) ? items : items ? [items] : [];
  const cleaned = values
    .map((item) => formatFarmerFacingText(item))
    .filter(Boolean);
  return cleaned.length ? cleaned : fallback;
}

function stringifyInsight(value) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}

function normalizeConfidence(value) {
  const text = stringifyInsight(value).toLowerCase();
  if (text.includes("high")) return "High";
  if (text.includes("low")) return "Low";
  if (text.includes("medium") || text.includes("moderate")) return "Medium";
  return "Medium";
}

function detectBuiltArea(result, genAiInsight = null) {
  const features = result?.features || result?.matched_environment || {};
  const satelliteAnalysis = result?.satellite_building_analysis;
  if (
    satelliteAnalysis?.status === "analyzed" &&
    satelliteAnalysis?.land_cover_override_recommended === true
  ) {
    return true;
  }

  const landCoverText = stringifyInsight(
    features.land_cover ||
      features.land_cover_class ||
      features.land_cover_label ||
      features.landcover ||
      features.land_use,
  );

  const analysisText = [
    landCoverText,
    result?.ai_insight,
    result?.explanation,
    result?.genai_insight?.crop_suitability_summary,
    result?.genai_insight?.potential_risks,
    result?.genai_insight?.recommended_actions,
    result?.genai_insight?.key_strengths,
    genAiInsight?.crop_suitability_summary,
    genAiInsight?.potential_risks,
    genAiInsight?.recommended_actions,
    genAiInsight?.key_strengths,
    result?.suitability?.limitations,
    result?.suitability?.risk_warnings,
    result?.suitability?.recommendations,
  ]
    .flatMap(flattenTextValues)
    .join(" ");

  return hasBuiltAreaTerm(analysisText);
}

function flattenTextValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenTextValues);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(flattenTextValues);
  const text = stringifyInsight(value);
  return text ? [text] : [];
}

function hasBuiltAreaTerm(value) {
  const text = stringifyInsight(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLowerCase();
  const withoutNegatedClassifications = text
    .replace(/\b(?:not|is not|isn't)\s+(?:a\s+)?built\s+up\b/g, "")
    .replace(/\bno\s+(?:visible\s+)?(?:buildings|development)\b/g, "");

  return Boolean(
    withoutNegatedClassifications &&
      BUILT_AREA_TERMS.some((term) => withoutNegatedClassifications.includes(term)),
  );
}
