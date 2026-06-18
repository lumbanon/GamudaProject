import { useState } from "react";
import DashboardLeafletMap, {
  getDistrictRainfall,
  getDistrictSuitability,
} from "./DashboardLeafletMap";
import "./dashboard-view.css";

const crops = ["Corn", "Banana", "Cocoa"];

const initialParameters = {
  temperature: 28.6,
  rainfall: 2458,
  humidity: 82,
  ph: 5.8,
  elevation: 120,
};

const parameterConfig = [
  {
    key: "temperature",
    label: "Temperature",
    unit: "\u00b0C",
    min: 15,
    max: 40,
    step: 0.1,
  },
  {
    key: "rainfall",
    label: "Annual Rainfall",
    unit: "mm",
    min: 500,
    max: 5000,
    step: 1,
  },
  {
    key: "humidity",
    label: "Humidity",
    unit: "%",
    min: 20,
    max: 100,
    step: 1,
  },
  {
    key: "ph",
    label: "Soil pH",
    unit: "",
    min: 3.5,
    max: 8.5,
    step: 0.1,
  },
  {
    key: "elevation",
    label: "Topographical Elevation",
    unit: "m",
    min: 0,
    max: 3000,
    step: 1,
  },
];

function Dashboard() {
  const [activeCrop, setActiveCrop] = useState("Corn");
  const [focusedDistrict, setFocusedDistrict] = useState("Sandakan");
  const [parameters, setParameters] = useState(initialParameters);

  const suitabilityScores = getDistrictSuitability(focusedDistrict);
  const yearlyRainfall = getDistrictRainfall(focusedDistrict);

  function updateParameter(key, value) {
    setParameters((current) => ({
      ...current,
      [key]: Number(value),
    }));
  }

  function resetParameters() {
    setParameters(initialParameters);
    setActiveCrop("Corn");
    setFocusedDistrict("Sandakan");
  }

  return (
    <div className="dashboard-page">
      <section className="dashboard-overview-card">
        <div>
          <span className="dashboard-eyebrow">Territory</span>
          <h1>Territory Overview: {focusedDistrict}</h1>
        </div>

        <div className="suitability-card-grid">
          <SuitabilityCard label="Banana Suitability" value={`${suitabilityScores.Banana}%`} />
          <SuitabilityCard label="Corn Suitability" value={`${suitabilityScores.Corn}%`} />
          <SuitabilityCard label="Cocoa Suitability" value={`${suitabilityScores.Cocoa}%`} />
        </div>
      </section>

      <section className="dashboard-main-grid">
        <article className="dashboard-card heatmap-card">
          <div className="dashboard-card-header">
            <div>
              <span className="dashboard-eyebrow">Land suitability</span>
              <h2>Sabah Land Suitability Heatmap</h2>
              <p>Click any area to analyze crop suitability score</p>
            </div>

            <div className="crop-toggle-group" aria-label="Crop heatmap selector">
              {crops.map((crop) => (
                <button
                  className={`crop-toggle ${activeCrop === crop ? "active" : ""}`}
                  key={crop}
                  type="button"
                  onClick={() => setActiveCrop(crop)}
                >
                  {crop}
                </button>
              ))}
            </div>
          </div>

          <div className="heatmap-visual" aria-label={`${activeCrop} suitability heatmap for Sabah`}>
            <DashboardLeafletMap
              activeCrop={activeCrop}
              focusedDistrict={focusedDistrict}
              onDistrictSelect={setFocusedDistrict}
            />

            <div className="map-legend" aria-label="Map legend">
              <LegendItem className="high" label="High suitability" />
              <LegendItem className="moderate" label="Moderate" />
              <LegendItem className="low" label="Low suitability" />
            </div>
          </div>

          <div className="heatmap-info-bar">
            <div>
              <span>Currently focused district</span>
              <strong>{focusedDistrict}</strong>
            </div>
            <div>
              <span>Yearly rainfall</span>
              <strong>{yearlyRainfall}mm</strong>
            </div>
          </div>
        </article>

        <aside className="dashboard-card modeling-card">
          <div className="dashboard-card-header compact">
            <div>
              <span className="dashboard-eyebrow">Simulation</span>
              <h2>Modeling Parameters</h2>
            </div>
          </div>

          <div className="parameter-list">
            {parameterConfig.map((parameter) => (
              <label className="parameter-control" key={parameter.key}>
                <span className="parameter-label-row">
                  <span>{parameter.label}</span>
                  <strong>
                    {formatValue(parameters[parameter.key], parameter.step)}
                    {parameter.unit}
                  </strong>
                </span>
                <input
                  type="range"
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  value={parameters[parameter.key]}
                  onChange={(event) => updateParameter(parameter.key, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="modeling-actions">
            <button className="apply-button" type="button">
              Apply Simulation
            </button>
            <button className="reset-button" type="button" onClick={resetParameters}>
              Reset
            </button>
          </div>
        </aside>
      </section>
    </div>
  );
}

function SuitabilityCard({ label, value }) {
  return (
    <article className="suitability-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function LegendItem({ className, label }) {
  return (
    <div className="legend-item">
      <i className={className} />
      <span>{label}</span>
    </div>
  );
}

function formatValue(value, step) {
  return step < 1 ? Number(value).toFixed(1) : Math.round(value);
}

export default Dashboard;
