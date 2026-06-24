import React from "react";
import "./statistic-view.css";

const summaryCards = [
  {
    label: "Coverage",
    value: "18",
    detail: "Districts monitored across Sabah",
  },
  {
    label: "Best crop",
    value: "Banana",
    detail: "Most stable overall performance",
  },
  {
    label: "Average yield",
    value: "82%",
    detail: "Blended suitability index",
  },
  {
    label: "Monitoring",
    value: "Live",
    detail: "Updated from dashboard inputs",
  },
];

const cropStats = [
  {
    crop: "Banana",
    suitability: 92,
    yield: "31.4 t/ha",
    districts: "Kudat, Tuaran, Ranau",
  },
  {
    crop: "Corn",
    suitability: 78,
    yield: "8.7 t/ha",
    districts: "Sandakan, Kota Marudu, Papar",
  },
  {
    crop: "Cocoa",
    suitability: 71,
    yield: "1.9 t/ha",
    districts: "Tawau, Lahad Datu, Kinabatangan",
  },
];

const seasonalBands = [
  { label: "Q1", banana: 88, corn: 74, cocoa: 68 },
  { label: "Q2", banana: 92, corn: 79, cocoa: 71 },
  { label: "Q3", banana: 86, corn: 76, cocoa: 73 },
  { label: "Q4", banana: 90, corn: 81, cocoa: 70 },
];

const districtRows = [
  {
    district: "Sandakan",
    banana: 84,
    corn: 79,
    cocoa: 69,
    note: "Balanced growth conditions",
  },
  {
    district: "Tuaran",
    banana: 93,
    corn: 76,
    cocoa: 66,
    note: "Strong rainfall alignment",
  },
  {
    district: "Kudat",
    banana: 89,
    corn: 73,
    cocoa: 62,
    note: "High banana stability",
  },
  {
    district: "Tawau",
    banana: 81,
    corn: 72,
    cocoa: 77,
    note: "Cocoa gains from soil profile",
  },
];

export default function StatisticViews() {
  return (
    <div className="statistics-page">
      <header className="statistics-hero">
        <div>
          <span className="statistics-eyebrow">Crop Statistics</span>
          <h1>Production and Suitability Dashboard</h1>
          <p>
            Compare crop strength, district readiness, and seasonal movement in
            one place.
          </p>
        </div>
        <div className="statistics-hero-badge">
          <span>LIVE UPDATE</span>
          <strong>Sabah crop snapshot</strong>
        </div>
      </header>

      <section className="statistics-summary-grid">
        {summaryCards.map((card) => (
          <article className="statistics-summary-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="statistics-content-grid">
        <RankingsSection data={cropStats} />
        <SeasonalSection data={seasonalBands} />
      </section>

      <MatrixSection data={districtRows} />
    </div>
  );
}

function RankingsSection({ data }) {
  return (
    <article className="statistics-card">
      <div className="statistics-card-heading">
        <h2>Highest performing crops</h2>
        <p className="statistics-card-note">
          A quick view of suitability, expected yield, and the districts where
          each crop is strongest.
        </p>
      </div>
      <div className="crop-rank-list">
        {data.map((item) => (
          <div key={item.crop} className="crop-rank-item">
            <div className="crop-rank-topline">
              <strong>{item.crop}</strong>
              <span>{item.yield}</span>
            </div>
            <div className="crop-score-track">
              <span style={{ width: `${item.suitability}%` }} />
            </div>
            <div className="crop-rank-meta">
              <span>{item.suitability}% suitability</span>
              <span>{item.districts}</span>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function SeasonalSection({ data }) {
  return (
    <article className="statistics-card">
      <div className="statistics-card-heading">
        <h2>Quarterly crop profile</h2>
        <p className="statistics-card-note">
          This compares crop performance through the year to reveal seasonal
          momentum and soft spots.
        </p>
      </div>
      <div className="season-chart">
        {data.map((band) => (
          <div className="season-band" key={band.label}>
            <span className="season-band-label">{band.label}</span>
            <div className="season-bars">
              <Bar label="Banana" value={band.banana} tone="banana" />
              <Bar label="Corn" value={band.corn} tone="corn" />
              <Bar label="Cocoa" value={band.cocoa} tone="cocoa" />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function MatrixSection({ data }) {
  return (
    <section className="statistics-card statistics-table-card">
      <div className="statistics-card-heading">
        <h2>Comparison across selected districts</h2>
        <p className="statistics-card-note">
          A compact matrix showing how each district performs for the key crops.
        </p>
      </div>
      <div className="statistics-table-wrap">
        <table className="statistics-table">
          <thead>
            <tr>
              <th>District</th>
              <th>Banana</th>
              <th>Corn</th>
              <th>Cocoa</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.district}>
                <td>{row.district}</td>
                <td>{row.banana}%</td>
                <td>{row.corn}%</td>
                <td>{row.cocoa}%</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Bar({ label, value, tone }) {
  return (
    <div className="season-bar-row">
      <span className="season-bar-label">{label}</span>
      <div className="season-bar-track">
        <span
          className={`season-bar-fill ${tone}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <strong>{value}%</strong>
    </div>
  );
}
