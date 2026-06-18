import { useEffect, useMemo, useState } from "react";
import { fetchGeminiCropRecommendation } from "./geminiRecommendationService";
import "./prediction-view.css";

const MAP_ANALYSIS_KEY = "cleek:mapAnalysisContext";
const LAST_PREDICTION_KEY = "cleek:lastPrediction";
const DEFAULT_POINT = { lat: 5.6, lon: 117.1 };

const DEMO_ENVIRONMENT_VALUES = {
  ph: 5.8,
  soc: 22.4,
  cec: 14.2,
  clay: 31,
  nitrogen: 0.18,
  sand: 42,
  bulkdensity: 1.21,
  rainfall: 2700,
  temperature: 27.2,
  dem: 386,
  slope: 8.5,
  land_cover: 40,
};

const RASTER_ENVIRONMENT_METRICS = [
  { key: "ph", label: "Soil pH", keys: ["ph"] },
  { key: "soc", label: "SOC / Organic Carbon", keys: ["soc", "organic_carbon"], unit: "g/kg" },
  { key: "cec", label: "CEC", keys: ["cec"], unit: "cmol(+)/kg" },
  { key: "clay", label: "Clay", keys: ["clay"], unit: "%" },
  { key: "nitrogen", label: "Nitrogen", keys: ["nitrogen"], unit: "%" },
  { key: "sand", label: "Sand", keys: ["sand"], unit: "%" },
  { key: "bulkdensity", label: "Bulk Density", keys: ["bulkdensity", "bulk_density"], unit: "g/cm3" },
  { key: "rainfall", label: "Rainfall", keys: ["rainfall"], unit: "mm/year" },
  { key: "temperature", label: "Temperature", keys: ["temperature"], unit: "deg C" },
  { key: "dem", label: "DEM / Elevation", keys: ["dem", "elevation"], unit: "m" },
  { key: "slope", label: "Slope", keys: ["slope"], unit: "deg" },
  { key: "land_cover", label: "Land Cover", keys: ["land_cover", "landCover"], formatter: formatLandCover },
];

const LAND_COVER_CLASSES = {
  0: "Unclassified",
  10: "Forest",
  20: "Shrubland",
  30: "Grassland",
  40: "Cropland",
  50: "Built-up Area",
  60: "Bare Land",
  70: "Snow or Ice",
  80: "Water",
  90: "Wetland",
  95: "Mangroves",
  100: "Moss or Lichen",
};

const DEMO_PREDICTION = {
  coordinates: { lat: DEFAULT_POINT.lat, lon: DEFAULT_POINT.lon },
  features: DEMO_ENVIRONMENT_VALUES,
  suitability_scores: { corn: 72, banana: 84, cocoa: 68 },
  suitability_classes: { corn: "moderate", banana: "high", cocoa: "moderate" },
  recommended_crop: "banana",
  recommended_label: "Banana",
  confidence: 87,
};

const DEMO_CROPS = [
  { key: "corn", label: "Corn", source: "Demo" },
  { key: "banana", label: "Banana", source: "Demo" },
  { key: "cocoa", label: "Cocoa", source: "Demo" },
];

const FALLBACK_CONTEXT = {
  selectedPoint: DEFAULT_POINT,
  activeDistrictLabel: "Default Sabah location",
  prediction: DEMO_PREDICTION,
  environmentValues: DEMO_ENVIRONMENT_VALUES,
  selectedDistricts: [],
  heatmapCrop: "banana",
  activeLayer: "ph",
  layerLabel: "Soil pH raster sample",
  locationAnalysis: null,
  heatmapSummary: null,
  updatedAt: "Demo data",
};

export default function PredictionViews() {
  const [context] = useState(() => loadMapAnalysisContext());
  const [crops, setCrops] = useState(DEMO_CROPS);
  const [selectedCropKeys, setSelectedCropKeys] = useState(["banana"]);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState("");
  const [geminiResult, setGeminiResult] = useState(null);

  const safeContext = useMemo(() => normalizeContext(context), [context]);
  const prediction = safeContext.prediction || DEMO_PREDICTION;
  const environmentValues =
    safeContext.environmentValues ||
    prediction?.features ||
    prediction?.environmental_data ||
    DEMO_ENVIRONMENT_VALUES;

  const report = useMemo(
    () =>
      buildReportModel({
        context: safeContext,
        crops,
        prediction,
        environmentValues,
        geminiResult,
      }),
    [crops, environmentValues, geminiResult, prediction, safeContext],
  );

  useEffect(() => {
    let cancelled = false;

    getCrops()
      .then((data) => {
        if (cancelled) return;
        const usableCrops = Array.isArray(data) && data.length ? data : DEMO_CROPS;
        const recommendedKey = prediction?.recommended_crop;
        setCrops(usableCrops);
        setSelectedCropKeys(
          recommendedKey ? [recommendedKey] : usableCrops[0]?.key ? [usableCrops[0].key] : ["banana"],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCrops(DEMO_CROPS);
          setSelectedCropKeys([prediction?.recommended_crop || "banana"]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [prediction?.recommended_crop]);

  async function handleGeminiAnalysis() {
    const cropKeys = selectedCropKeys.length ? selectedCropKeys : [prediction?.recommended_crop || "banana"];

    setGeminiError("");
    setGeminiResult(null);
    setSelectedCropKeys(cropKeys);
    setGeminiLoading(true);

    try {
      const result = await fetchGeminiCropRecommendation(buildGeminiReportData(report, cropKeys, crops));

      if (!result.configured) {
        setGeminiResult({
          missingKey: true,
          summary: result.message || "Gemini API key is not configured yet.",
          recommendation: null,
        });
        return;
      }

      setGeminiResult({
        missingKey: false,
        summary: result.recommendation?.reason || "Gemini returned a refreshed crop recommendation.",
        recommendation: result.recommendation,
      });
    } catch (err) {
      setGeminiError(err.message || "Gemini analysis failed.");
    } finally {
      setGeminiLoading(false);
    }
  }

  function handleDownloadReport() {
    window.print();
  }

  return (
    <div className="page-stack ai-analysis-page">
      <section className="ai-report-header">
        <div>
          <span className="eyebrow">🤖 AI Predictions</span>
          <h1>GIS Crop Intelligence Report</h1>
          <p>
            Crop suitability, raster context, and environmental values for {report.district} at{" "}
            {report.latitude}, {report.longitude}.
          </p>
        </div>
        <button className="ai-download-button" type="button" onClick={handleDownloadReport}>
          Download PDF Report
        </button>
      </section>

      <section className="ai-report-layout">
        <div className="ai-report-column">
          <article className="ai-report-card ai-score-card">
            <div className="ai-card-heading">
              <span>📈 Overall Suitability Score (0-100)</span>
              <strong>{report.suitabilityScore}/100</strong>
            </div>
            <div className="ai-score-visual">
              <div>
                <strong>{report.suitabilityScore}</strong>
                <span>Suitability</span>
              </div>
              <div className="score-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(0, report.suitabilityScore))}%` }} />
              </div>
            </div>
            <div className="ai-summary-metrics">
              <MetricBadge label="Climate Risk" value={report.climateRisk} status={report.riskStatus} />
              <MetricBadge label="Confidence Level" value={report.confidenceLabel} status="good" />
              <MetricBadge label="Best Planting Window" value={report.plantingWindow} status="neutral" />
            </div>
            <p>{report.aiExplanation}</p>
          </article>

          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>🧠 Gemini AI Recommendation</span>
              <strong>{geminiResult ? "Generated" : "Ready"}</strong>
            </div>
            <p>
              {geminiResult?.missingKey
                ? "Connect a Gemini API key to generate a fresh advisory note."
                : report.geminiSummary}
            </p>
            {geminiResult?.recommendation && (
              <div className="gemini-recommendation-grid">
                <MetadataRow label="Recommended crop" value={geminiResult.recommendation.recommendedCrop} />
                <MetadataRow label="Risks" value={geminiResult.recommendation.risks} />
                <MetadataRow label="Suggested action" value={geminiResult.recommendation.suggestedAction} />
              </div>
            )}
            {geminiResult?.missingKey && <div className="empty-panel">{geminiResult.summary}</div>}
            <button
              className="ai-inline-action"
              type="button"
              onClick={handleGeminiAnalysis}
              disabled={!selectedCropKeys.length || geminiLoading}
            >
              {geminiLoading ? "Analyzing with Gemini..." : "Refresh Gemini Recommendation"}
            </button>
            {!selectedCropKeys.length && (
              <div className="empty-panel">Select at least one crop before running Gemini.</div>
            )}
            {geminiError && <p className="form-error">{geminiError}</p>}
          </article>

          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>🌱 Best Crop</span>
              <strong>{report.recommendedCrop}</strong>
            </div>
            <div className="crop-recommendation-grid">
              <div>
                <span>Recommended Crop</span>
                <strong>{report.recommendedCrop}</strong>
              </div>
              <div>
                <span>Alternative Crops</span>
                <strong>{report.alternativeCrops}</strong>
              </div>
            </div>
            <RecommendationList title="Key Strengths" items={report.keyStrengths} />
            <RecommendationList title="Main Constraints" items={report.mainConstraints} />
            <div className="suggested-action">
              <span>Suggested Action</span>
              <strong>{report.suggestedAction}</strong>
            </div>
          </article>

          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>🗓️ Planting Window</span>
              <strong>{report.plantingWindowShort}</strong>
            </div>
            <p>{report.plantingWindowDetail}</p>
          </article>

          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>⚠️ Risk Factors</span>
              <strong>{report.climateRisk}</strong>
            </div>
            <div className="risk-factor-list">
              {report.riskFactors.map((item) => (
                <RiskRow item={item} key={item.label} />
              ))}
            </div>
          </article>

          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>✅ Confidence Score</span>
              <strong>{report.confidenceLabel}</strong>
            </div>
            <p>{report.confidenceExplanation}</p>
          </article>
        </div>

        <aside className="ai-report-column ai-report-sidebar">
          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>📍 District Information</span>
              <strong>{report.district}</strong>
            </div>
            <div className="metadata-list">
              <MetadataRow label="District" value={report.district} />
              <MetadataRow label="Latitude / Longitude" value={`${report.latitude}, ${report.longitude}`} />
              <MetadataRow label="Raster Source" value={report.rasterLayer} />
              <MetadataRow label="Dataset Last Updated" value={report.lastUpdated} />
            </div>
          </article>

          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>🗺️ Raster Source</span>
              <strong>{report.datasetName}</strong>
            </div>
            <div className="metadata-list">
              <MetadataRow label="Dataset name" value={report.datasetName} />
              <MetadataRow label="Resolution" value={report.resolution} />
              <MetadataRow label="Coordinate system" value={report.coordinateSystem} />
              <MetadataRow label="Data source" value={report.dataSource} />
              <MetadataRow label="Tile / sample ID" value={report.sampleId} />
            </div>
          </article>

          <article className="ai-report-card">
            <div className="ai-card-heading">
              <span>🌍 Environmental Values</span>
              <strong>Raster sample</strong>
            </div>
            <div className="environment-report-grid">
              {report.environmentMetrics.map((metric) => (
                <EnvironmentalMetric key={metric.key} label={metric.label} value={metric.value} />
              ))}
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

function MetricBadge({ label, value, status }) {
  return (
    <div className="ai-metric-badge">
      <span>{label}</span>
      <strong className={`status-badge ${statusToClass(status)}`}>{value}</strong>
    </div>
  );
}

function RecommendationList({ title, items }) {
  return (
    <div className="recommendation-list">
      <span>{title}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function RiskRow({ item }) {
  return (
    <div className="risk-factor-row">
      <div>
        <span>{item.label}</span>
        <strong>{item.value}</strong>
      </div>
      <b className={`status-badge ${statusToClass(item.status)}`}>{item.statusLabel}</b>
    </div>
  );
}

function MetadataRow({ label, value }) {
  return (
    <div className="metadata-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EnvironmentalMetric({ label, value }) {
  return (
    <div className="environment-report-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function getCrops() {
  return DEMO_CROPS;
}

function loadMapAnalysisContext() {
  try {
    const stored = localStorage.getItem(MAP_ANALYSIS_KEY);
    if (stored) return normalizeContext(JSON.parse(stored));

    const lastPrediction = localStorage.getItem(LAST_PREDICTION_KEY);
    if (lastPrediction) {
      const parsedPrediction = JSON.parse(lastPrediction);
      const prediction =
        parsedPrediction && typeof parsedPrediction === "object" ? parsedPrediction : DEMO_PREDICTION;
      const coordinates = prediction.coordinates || {};
      const selectedPoint = {
        lat: Number(coordinates.lat ?? DEFAULT_POINT.lat),
        lon: Number(coordinates.lon ?? DEFAULT_POINT.lon),
      };

      return normalizeContext({
        selectedPoint,
        activeDistrictLabel: "Last selected Sabah location",
        prediction,
        environmentValues: prediction?.features || prediction?.environmental_data || DEMO_ENVIRONMENT_VALUES,
        selectedDistricts: [],
        heatmapCrop: prediction?.recommended_crop || "",
        activeLayer: "",
        layerLabel: "",
        locationAnalysis: null,
        heatmapSummary: null,
        updatedAt: new Date().toISOString(),
      });
    }

    return normalizeContext(FALLBACK_CONTEXT);
  } catch {
    return normalizeContext(FALLBACK_CONTEXT);
  }
}

function normalizeContext(value) {
  const source = value && typeof value === "object" ? value : {};
  const prediction = source.prediction && typeof source.prediction === "object" ? source.prediction : DEMO_PREDICTION;
  const environmentValues =
    source.environmentValues || prediction?.features || prediction?.environmental_data || DEMO_ENVIRONMENT_VALUES;

  return {
    ...FALLBACK_CONTEXT,
    ...source,
    selectedPoint: normalizePoint(source.selectedPoint),
    activeDistrictLabel: source.activeDistrictLabel || FALLBACK_CONTEXT.activeDistrictLabel,
    prediction,
    environmentValues,
    selectedDistricts: Array.isArray(source.selectedDistricts) ? source.selectedDistricts : [],
    heatmapCrop: source.heatmapCrop || prediction?.recommended_crop || FALLBACK_CONTEXT.heatmapCrop,
    activeLayer: source.activeLayer || FALLBACK_CONTEXT.activeLayer,
    layerLabel: source.layerLabel || FALLBACK_CONTEXT.layerLabel,
    updatedAt: source.updatedAt || FALLBACK_CONTEXT.updatedAt,
  };
}

function normalizePoint(point) {
  const lat = Number(point?.lat ?? point?.latitude ?? DEFAULT_POINT.lat);
  const lon = Number(point?.lon ?? point?.lng ?? point?.longitude ?? DEFAULT_POINT.lon);

  return {
    lat: Number.isFinite(lat) ? lat : DEFAULT_POINT.lat,
    lon: Number.isFinite(lon) ? lon : DEFAULT_POINT.lon,
  };
}

function buildGeminiReportData(report, selectedCropKeys, crops) {
  const selectedCropLabels = selectedCropKeys
    .map((cropKey) => crops.find((crop) => crop.key === cropKey)?.label || toTitleCase(cropKey))
    .filter(Boolean);

  return {
    bestCrop: selectedCropLabels[0] || report.recommendedCrop,
    alternativeCrops: report.alternativeCropList,
    district: report.district,
    coordinates: {
      latitude: report.latitude,
      longitude: report.longitude,
    },
    score: report.suitabilityScore,
    rasterSource: report.rasterLayer,
    environment: {
      elevation: report.environment.elevation,
      rainfall: report.environment.rainfall,
      temperature: report.environment.temperature,
      soilPh: report.environment.soilPh,
      organicCarbon: report.environment.organicCarbon,
      slope: report.environment.slope,
    },
  };
}

function buildReportModel({ context, crops, prediction, environmentValues, geminiResult }) {
  const selectedPoint = normalizePoint(context.selectedPoint);
  const recommendedKey = prediction?.recommended_crop || context.heatmapCrop || "banana";
  const cropLabelMap = new Map(crops.map((crop) => [crop.key, crop.label || crop.key]));
  const recommendedCrop =
    prediction?.recommended_label ||
    cropLabelMap.get(recommendedKey) ||
    toTitleCase(recommendedKey) ||
    "Recommended crop unavailable";
  const suitabilityScore = getSuitabilityScore(prediction, recommendedKey);
  const confidenceScore = getConfidenceScore(prediction?.confidence);
  const confidenceLabel = confidenceScore ? `${roundNumber(confidenceScore, 0)}%` : "87%";
  const riskFactors = buildRiskFactors(environmentValues);
  const climateRisk = buildClimateRisk(suitabilityScore, riskFactors);
  const alternativeCropList = buildAlternativeCropList(prediction, crops, recommendedKey);
  const keyStrengths = buildKeyStrengths(environmentValues, recommendedCrop);
  const mainConstraints = buildMainConstraints(environmentValues);
  const plantingWindow = buildPlantingWindow(environmentValues);
  const district = cleanText(context.activeDistrictLabel, "Default Sabah location");
  const rasterLayer = cleanText(context.layerLabel || context.activeLayer, "Soil pH raster sample");
  const sampleId = buildSampleId(context, selectedPoint);
  const environmentMetrics = buildEnvironmentMetrics(environmentValues);

  return {
    district,
    latitude: formatCoordinate(selectedPoint.lat),
    longitude: formatCoordinate(selectedPoint.lon),
    rasterLayer,
    lastUpdated: formatDate(context.updatedAt),
    recommendedCrop,
    alternativeCropList,
    alternativeCrops: alternativeCropList.join(", ") || "Corn, Cocoa",
    suitabilityScore,
    confidenceLabel,
    confidenceScore,
    confidenceExplanation: `Confidence blends model certainty with available raster features. This report currently has ${confidenceLabel} confidence based on sampled environmental layers and crop suitability scores.`,
    climateRisk: climateRisk.label,
    riskStatus: climateRisk.status,
    plantingWindow,
    plantingWindowShort: plantingWindow.split(" after ")[0],
    plantingWindowDetail:
      "Schedule field work around the rainfall transition, then verify drainage, access, and soil preparation before planting.",
    aiExplanation: `The selected point is most suitable for ${recommendedCrop} because the raster sample shows manageable terrain, rainfall, and topsoil indicators for Sabah crop planning.`,
    geminiSummary:
      geminiResult?.summary ||
      `Gemini analysis is ready to compare ${recommendedCrop} against local terrain, soil, and raster values. Run the analysis to generate a fresh advisory note.`,
    keyStrengths,
    mainConstraints,
    suggestedAction: buildSuggestedAction(climateRisk, recommendedCrop),
    riskFactors,
    datasetName: rasterLayer,
    resolution: inferResolution(context),
    coordinateSystem: "EPSG:3857 Web Mercator tiles; source rasters sampled from PostGIS",
    dataSource: inferDataSource(context),
    sampleId,
    environmentMetrics,
    environment: {
      ph: getMetricValue(environmentMetrics, "ph"),
      soilPh: getMetricValue(environmentMetrics, "ph"),
      organicCarbon: getMetricValue(environmentMetrics, "soc"),
      soc: getMetricValue(environmentMetrics, "soc"),
      cec: getMetricValue(environmentMetrics, "cec"),
      clay: getMetricValue(environmentMetrics, "clay"),
      nitrogen: getMetricValue(environmentMetrics, "nitrogen"),
      sand: getMetricValue(environmentMetrics, "sand"),
      bulkdensity: getMetricValue(environmentMetrics, "bulkdensity"),
      rainfall: getMetricValue(environmentMetrics, "rainfall"),
      temperature: getMetricValue(environmentMetrics, "temperature"),
      elevation: getMetricValue(environmentMetrics, "dem"),
      dem: getMetricValue(environmentMetrics, "dem"),
      slope: getMetricValue(environmentMetrics, "slope"),
      landCover: getMetricValue(environmentMetrics, "land_cover"),
    },
  };
}

function buildEnvironmentMetrics(values = {}) {
  return RASTER_ENVIRONMENT_METRICS.map((metric) => {
    const rawValue = getFirstValue(values, metric.keys);
    const value = metric.formatter ? metric.formatter(rawValue) : formatEnvValue(rawValue, metric.unit || "");

    return {
      key: metric.key,
      label: metric.label,
      value,
    };
  });
}

function getMetricValue(metrics, key) {
  return metrics.find((metric) => metric.key === key)?.value || "N/A";
}

function getFirstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function buildAlternativeCropList(prediction, crops, recommendedKey) {
  const scores = prediction?.suitability_scores || {};
  const ranked = Object.entries(scores)
    .filter(([key]) => key !== recommendedKey)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 2)
    .map(([key]) => crops.find((crop) => crop.key === key)?.label || toTitleCase(key));

  if (ranked.length) return ranked;

  const fallback = crops
    .filter((crop) => crop.key !== recommendedKey)
    .slice(0, 2)
    .map((crop) => crop.label || toTitleCase(crop.key));

  return fallback.length ? fallback : ["Corn", "Cocoa"];
}

function buildRiskFactors(values) {
  const rainfall = getNumber(values?.rainfall);
  const slope = getNumber(values?.slope);
  const ph = getNumber(values?.ph);
  const elevation = getNumber(values?.dem);

  return [
    {
      label: "Rainfall condition",
      value: formatEnvValue(rainfall, "mm/year"),
      ...classifyRange(rainfall, [1800, 3200], [1200, 3600]),
    },
    {
      label: "Terrain/slope condition",
      value: formatEnvValue(slope, "deg"),
      ...classifyMaximum(slope, 10, 22),
    },
    {
      label: "Soil condition",
      value: `pH ${formatEnvValue(ph)}`,
      ...classifyRange(ph, [5.5, 7], [5, 7.5]),
    },
    {
      label: "Elevation condition",
      value: formatEnvValue(elevation, "m"),
      ...classifyMaximum(elevation, 900, 1500),
    },
  ];
}

function buildClimateRisk(score, riskFactors) {
  const warningCount = riskFactors.filter((item) => item.status === "warning").length;
  const moderateCount = riskFactors.filter((item) => item.status === "moderate").length;

  if (score >= 75 && warningCount === 0) return { label: "Low", status: "good" };
  if (score >= 55 && warningCount <= 1 && moderateCount <= 3) return { label: "Medium", status: "moderate" };
  return { label: "High", status: "warning" };
}

function buildKeyStrengths(values, cropName) {
  const strengths = [];
  const rainfall = getNumber(values?.rainfall);
  const slope = getNumber(values?.slope);
  const ph = getNumber(values?.ph);
  const soc = getNumber(values?.soc);

  if (rainfall >= 1800 && rainfall <= 3200) strengths.push("Rainfall is within a strong planning range.");
  if (!Number.isFinite(slope) || slope <= 10) strengths.push("Terrain appears workable for managed cultivation.");
  if (ph >= 5.5 && ph <= 7) strengths.push("Topsoil pH is suitable for most tropical crops.");
  if (soc >= 18) strengths.push("Organic carbon signal supports healthy soil structure.");

  return strengths.length ? strengths : [`${cropName} remains the best current match from available raster values.`];
}

function buildMainConstraints(values) {
  const constraints = [];
  const rainfall = getNumber(values?.rainfall);
  const slope = getNumber(values?.slope);
  const ph = getNumber(values?.ph);
  const elevation = getNumber(values?.dem);

  if (rainfall > 3400) constraints.push("High rainfall may require drainage planning.");
  if (rainfall > 0 && rainfall < 1400) constraints.push("Lower rainfall may require irrigation support.");
  if (slope > 18) constraints.push("Slope may limit mechanized access and increase erosion risk.");
  if (ph > 0 && (ph < 5 || ph > 7.5)) constraints.push("Soil pH may require amendment before planting.");
  if (elevation > 1500) constraints.push("Elevation may reduce crop suitability for warm lowland crops.");

  return constraints.length ? constraints : ["No critical constraints detected from the current raster sample."];
}

function buildSuggestedAction(climateRisk, cropName) {
  if (climateRisk.status === "warning") {
    return `Validate field conditions before committing to ${cropName}; prioritize drainage, slope, and soil correction checks.`;
  }
  if (climateRisk.status === "moderate") {
    return `Proceed with ${cropName} planning after confirming drainage and topsoil conditions on site.`;
  }
  return `Proceed with ${cropName} as the lead crop and schedule planting around the wet-season transition.`;
}

function buildPlantingWindow(values) {
  const rainfall = getNumber(values?.rainfall);
  if (rainfall > 3200) return "Start of wet season after drainage check";
  if (rainfall > 0 && rainfall < 1500) return "Early wet season with irrigation backup";
  return "Start of wet season after drainage check";
}

function inferResolution(context) {
  const layer = `${context.layerLabel || context.activeLayer || ""}`.toLowerCase();
  if (layer.includes("0-5") || layer.includes("topsoil") || layer.includes("soil")) {
    return "SoilGrids 0-5cm topsoil raster sample";
  }
  if (layer.includes("rainfall") || layer.includes("temperature")) {
    return "Climate raster sample, tile-based display";
  }
  return "256x256 raster tile sample";
}

function inferDataSource(context) {
  const source = context.locationAnalysis?.source || context.locationAnalysis?.data_source;
  return cleanText(source, "Cleek PostGIS raster and district database");
}

function buildSampleId(context, point) {
  const explicitId = context.locationAnalysis?.sample_id || context.locationAnalysis?.tile_id || context.locationAnalysis?.id;
  if (explicitId) return String(explicitId);
  return `${context.activeLayer || "raster"}:${formatCoordinate(point.lat)},${formatCoordinate(point.lon)}`;
}

function getSuitabilityScore(prediction, cropKey) {
  const score = Number(prediction?.suitability_scores?.[cropKey]);
  if (Number.isFinite(score)) return roundNumber(score, 0);
  const confidence = getConfidenceScore(prediction?.confidence);
  return confidence ? roundNumber(confidence, 0) : 82;
}

function getConfidenceScore(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const parsed = Number(value.score ?? value.value ?? value.confidence ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function classifyRange(value, goodRange, moderateRange) {
  if (!Number.isFinite(value) || value <= 0) return { status: "moderate", statusLabel: "Moderate" };
  if (value >= goodRange[0] && value <= goodRange[1]) return { status: "good", statusLabel: "Good" };
  if (value >= moderateRange[0] && value <= moderateRange[1]) return { status: "moderate", statusLabel: "Moderate" };
  return { status: "warning", statusLabel: "Warning" };
}

function classifyMaximum(value, goodMaximum, moderateMaximum) {
  if (!Number.isFinite(value) || value <= 0) return { status: "moderate", statusLabel: "Moderate" };
  if (value <= goodMaximum) return { status: "good", statusLabel: "Good" };
  if (value <= moderateMaximum) return { status: "moderate", statusLabel: "Moderate" };
  return { status: "warning", statusLabel: "Warning" };
}

function statusToClass(status) {
  if (status === "good" || status === "low") return "status-good";
  if (status === "warning" || status === "high") return "status-warning";
  if (status === "neutral") return "status-neutral";
  return "status-moderate";
}

function formatEnvValue(value, unit = "") {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number" && !Number.isFinite(value)) return "N/A";
  const number = Number(value);
  const display = Number.isFinite(number) ? roundNumber(number, number % 1 === 0 ? 0 : 2) : value;
  return unit ? `${display} ${unit}` : String(display);
}

function formatLandCover(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const classCode = Math.round(Number(value));
  if (!Number.isFinite(classCode)) return String(value);
  return LAND_COVER_CLASSES[classCode] || `Unknown (${classCode})`;
}

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : "N/A";
}

function formatDate(value) {
  if (!value || value === "Demo data") return "Demo data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function roundNumber(value, digits = 1) {
  return Number(Number(value).toFixed(digits));
}

function cleanText(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function toTitleCase(value) {
  return cleanText(value, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
