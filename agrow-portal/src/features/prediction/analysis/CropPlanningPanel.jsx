import successIcon from "../../../assets/prediction/success.svg?raw"
import locationIcon from "../../../assets/prediction/location.svg?raw"
import mapBoundaryIcon from "../../../assets/prediction/map-boundary.svg?raw"
import mapPinIcon from "../../../assets/prediction/map-pin.svg?raw"
import refreshIcon from "../../../assets/prediction/refresh.svg?raw"
import sproutIcon from "../../../assets/prediction/sprout.svg?raw"
import PredictionAssetIcon from "./PredictionAssetIcon"
import {
  buildClimateFeatureRows,
  buildSoilFeatureRows,
  buildTopoFeatureRows,
  formatFarmerDataSourceLabel,
  formatHectares,
} from "./predictionUtils"

export default function CropPlanningPanel({
  areaHectares,
  canAnalyze,
  cropOptions,
  districtOptions,
  hasLocation,
  hasPolygon,
  isLoading,
  isLoadingOptions,
  onAnalyze,
  onClearArea,
  onCropChange,
  onDistrictChange,
  selectedCrop,
  selectedDistrict,
}) {
  const cropSelected = Boolean(selectedCrop)
  const locationSelected = Boolean(hasLocation)
  const ready = canAnalyze && !isLoading

  return (
    <aside className="crop-planning-panel">
      <section className="planning-control-card">
        <div className="planning-progress" aria-label="Planning progress">
          <ProgressItem complete={locationSelected} description="Set your farm area" icon={<LocationIcon />} label="Location" />
          <ProgressItem complete={cropSelected} description="Choose crop details" icon={<SproutIcon />} label="Crop" />
          <ProgressItem complete={ready} description="Analyze and proceed" icon={<CheckIcon />} label="Ready" />
        </div>

        <div className="planning-control-grid">
          <div className="control-field">
            <span className="field-title">1. Farm area</span>
            <strong>{formatHectares(areaHectares)}</strong>
            <span className="field-helper">
              <MapIcon />
              {hasPolygon ? "Boundary captured" : "Draw on the map or choose district"}
            </span>
          </div>

          <label className="control-field crop-control-field" htmlFor="planning-district">
            <span className="field-title">2. District</span>
            <span className="select-shell">
              <LocationIcon />
              <select
                id="planning-district"
                value={selectedDistrict}
                onChange={(event) => onDistrictChange(event.target.value)}
                disabled={isLoadingOptions || (!selectedDistrict && districtOptions.length === 0)}
              >
                <option value="">{hasPolygon ? "Detecting from boundary" : "All matched map area"}</option>
                {selectedDistrict && !districtOptions.includes(selectedDistrict) && (
                  <option value={selectedDistrict}>{selectedDistrict}</option>
                )}
                {districtOptions.map((district) => (
                  <option value={district} key={district}>
                    {district}
                  </option>
                ))}
              </select>
            </span>
            <span className="field-helper">
              <PinIcon />
              {selectedDistrict ? (hasPolygon ? "Detected from boundary" : "Selected district") : "District appears after drawing"}
            </span>
          </label>

          <label className="control-field crop-control-field" htmlFor="planning-crop">
            <span className="field-title">3. Crop</span>
            <span className="select-shell">
              <SproutIcon />
              <select
                id="planning-crop"
                value={selectedCrop}
                onChange={(event) => onCropChange(event.target.value)}
                disabled={isLoadingOptions || cropOptions.length === 0}
              >
                <option value="">{isLoadingOptions ? "Loading crops..." : "Select crop"}</option>
                {cropOptions.map((crop) => (
                  <option value={crop.name} key={crop.id || crop.name}>
                    {crop.name}
                  </option>
                ))}
              </select>
            </span>
            <span className="field-helper">
              <SproutIcon />
              {selectedCrop ? "Crop details selected" : "Choose a crop to continue"}
            </span>
          </label>
        </div>

        <div className="planning-action-row">
          <button className="analyze-area-button" type="button" onClick={onAnalyze} disabled={!canAnalyze || isLoading}>
            <SproutIcon />
            <span>{isLoading ? "Analyzing..." : "Analyze Farm Area"}</span>
          </button>
          <button className="clear-area-button" type="button" onClick={onClearArea} disabled={!hasLocation && !areaHectares}>
            <RefreshIcon />
            <span>Clear</span>
          </button>
        </div>
      </section>
    </aside>
  )
}

function ProgressItem({ complete, description, icon, label }) {
  return (
    <div className={`progress-item ${complete ? "complete" : ""}`}>
      <span className="progress-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="progress-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </div>
  )
}

export function EnvironmentDataPanel({ isLoading, result }) {
  const isBlocked = Boolean(result?.allowed === false || result?.blocked_reason === "reserved_forest")
  const features = isBlocked ? null : result?.features || null
  const sourceValue = features?.data_source
  const satelliteAnalysis = isBlocked ? null : result?.satellite_building_analysis || null

  return (
    <section className="sidebar-environment-panel">
      <div className="sidebar-environment-heading">
        <span>Environmental data</span>
        {sourceValue && (
          <strong className={`source-pill source-${sourceValue}`}>{formatFarmerDataSourceLabel(sourceValue)}</strong>
        )}
      </div>

      <div className="sidebar-environment-content">
        {isBlocked && !isLoading && (
          <div className="planning-error-state compact-empty-state">Protected land check stopped environmental analysis.</div>
        )}

        {!features && !isLoading && !isBlocked && (
          <div className="planning-empty-state compact-empty-state">Environmental layers will appear here after analysis.</div>
        )}

        {isLoading && <div className="planning-loading-state compact-empty-state">Loading environmental layers...</div>}

        {features && (
          <div className="environment-sidebar-stack">
            <FeatureAccordion
              labelClassName="environment-card-label"
              title="Climate data"
              rows={buildClimateFeatureRows(features)}
            />
            <FeatureAccordion
              labelClassName="environment-card-label"
              title="Soil data"
              rows={buildSoilFeatureRows(features)}
            />
            <FeatureAccordion
              labelClassName="environment-card-label"
              title="Topography data"
              rows={buildTopoFeatureRows(features)}
            />
            {satelliteAnalysis && (
              <FeatureAccordion
                labelClassName="satellite-building-check-label"
                title="Gemini satellite building check"
                rows={buildSatelliteAnalysisRows(satelliteAnalysis)}
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function buildSatelliteAnalysisRows(analysis) {
  if (analysis?.status !== "analyzed") {
    return [
      { label: "Status", value: "Unavailable" },
      { label: "Reason", value: analysis?.failure_reason || "No usable satellite crop was provided" },
    ]
  }

  const percent = Number(analysis.estimated_built_up_percent)
  return [
    {
      label: "Buildings visible",
      value:
        analysis.buildings_detected === true
          ? "Yes"
          : analysis.buildings_detected === false
            ? "No"
            : "Inconclusive",
    },
    {
      label: "Site classification",
      value:
        analysis.is_built_up === true
          ? "Built-up"
          : analysis.is_built_up === false
            ? "Not built-up"
            : "Inconclusive",
    },
    {
      label: "Estimated developed area",
      value: Number.isFinite(percent) ? `${percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "N/A",
    },
    { label: "Vision confidence", value: String(analysis.confidence || "N/A").replace(/^./, (letter) => letter.toUpperCase()) },
  ]
}

function FeatureAccordion({ labelClassName, title, rows }) {
  return (
    <details className="planning-accordion feature-accordion" open>
      <summary>{title}</summary>
      <div className="feature-grid">
        {rows.map((feature) => (
          <div className="feature-tile" key={feature.label}>
            <span className={labelClassName}>{feature.label}</span>
            <strong>{feature.value}</strong>
          </div>
        ))}
      </div>
    </details>
  )
}

function CheckIcon() {
  return <PredictionAssetIcon src={successIcon} />
}

function LocationIcon() {
  return <PredictionAssetIcon src={locationIcon} />
}

function MapIcon() {
  return <PredictionAssetIcon src={mapBoundaryIcon} />
}

function PinIcon() {
  return <PredictionAssetIcon src={mapPinIcon} />
}

function RefreshIcon() {
  return <PredictionAssetIcon src={refreshIcon} />
}

function SproutIcon() {
  return <PredictionAssetIcon src={sproutIcon} />
}
