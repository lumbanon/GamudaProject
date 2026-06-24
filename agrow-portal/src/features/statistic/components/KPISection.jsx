import React from "react";
import "./KPISection.css"; // Don't forget to create this CSS file

export default function KPISection() {
  return (
    <section className="kpi-grid">
      <div className="kpi-card">
        <span className="kpi-label">Total Yield</span>
        <strong className="kpi-value">279.3 Tons</strong>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Healthy Crops %</span>
        <div className="progress-bar-container">
          <div className="progress-bar-fill" style={{ width: "85%" }}></div>
        </div>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Projected Harvest Date</span>
        <strong className="kpi-value">Jun 26</strong>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Soil Nutrient Index</span>
        {/* Placeholder for your gauge chart */}
        <div className="gauge-placeholder">--Gauge Chart--</div>
      </div>
    </section>
  );
}
