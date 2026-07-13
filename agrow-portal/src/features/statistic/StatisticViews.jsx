import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import "./statistic-view.css";

// Data Configuration
const summaryCards = [
  {
    label: "Coverage",
    value: "18",
    detail: "Districts monitored across Sabah",
  },
  {
    label: "Best crop",
    value: "Watermelon",
    detail: "Most stable overall performance",
  },
  { label: "Average yield", value: "82%", detail: "Blended suitability index" },
  {
    label: "Monitoring",
    value: "Live",
    detail: "Updated from dashboard inputs",
  },
];

const cropStats = [
  {
    crop: "Watermelon",
    suitability: 92,
    yield: "31.4 t/ha",
    districts: "Kudat, Tuaran, Ranau",
  },
  {
    crop: "Durian",
    suitability: 78,
    yield: "8.7 t/ha",
    districts: "Sandakan, Kota Marudu, Papar",
  },
  {
    crop: "Cabbage",
    suitability: 71,
    yield: "1.9 t/ha",
    districts: "Tawau, Lahad Datu, Kinabatangan",
  },
];

const seasonalBands = [
  { label: "Q1", Watermelon: 88, Durian: 74, Cabbage: 68 },
  { label: "Q2", Watermelon: 92, Durian: 79, Cabbage: 71 },
  { label: "Q3", Watermelon: 86, Durian: 76, Cabbage: 73 },
  { label: "Q4", Watermelon: 90, Durian: 81, Cabbage: 70 },
];

const districtRows = [
  {
    district: "Sandakan",
    Watermelon: 84,
    Durian: 79,
    Cabbage: 69,
    note: "Balanced growth conditions",
  },
  {
    district: "Tuaran",
    Watermelon: 93,
    Durian: 76,
    Cabbage: 66,
    note: "Strong rainfall alignment",
  },
  {
    district: "Kudat",
    Watermelon: 89,
    Durian: 73,
    Cabbage: 62,
    note: "High Watermelon stability",
  },
  {
    district: "Tawau",
    Watermelon: 81,
    Durian: 72,
    Cabbage: 77,
    note: "Cabbage gains from soil profile",
  },
];

export default function StatisticViews() {
  return (
    <div className="statistics-page">
      <header className="statistics-hero">
        <div>
          <span className="statistics-eyebrow">
            Comprehensive Crop Analytics
          </span>
          <h1>Sabah Agricultural Production Dashboard</h1>
          <p>
            Real-time monitoring of crop suitability, seasonal trends, and
            district-level performance metrics.
          </p>
        </div>
        {/* <div className="statistics-hero-badge">
          <span>LIVE SYSTEM</span>
        </div> */}
      </header>

      {/* Summary Stats */}
      <section className="statistics-summary-grid">
        {summaryCards.map((card) => (
          <article className="statistics-summary-card" key={card.label}>
            <span>{card.label}: </span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      {/* Primary Content Grid */}
      <section className="statistics-content-grid">
        <RankingsSection data={cropStats} />

        <article className="statistics-card">
          <div className="statistics-card-heading">
            <h2>Quarterly Crop Trends</h2>
          </div>
          <div style={{ height: "300px", width: "100%" }}>
            <ResponsiveContainer>
              <LineChart data={seasonalBands}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis domain={[60, 100]} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Watermelon"
                  stroke="#f59e0b"
                  strokeWidth={3}
                />
                <Line
                  type="monotone"
                  dataKey="Durian"
                  stroke="#10b981"
                  strokeWidth={3}
                />
                <Line
                  type="monotone"
                  dataKey="Cabbage"
                  stroke="#78350f"
                  strokeWidth={3}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      {/* Extended Analysis Grid */}
      <section className="statistics-analysis-extended">
        <MatrixSection data={districtRows} />

        <article className="statistics-card">
          <div className="statistics-card-heading">
            <h2>District Comparison</h2>
            <p>Weighted performance overview.</p>
          </div>
          <div style={{ height: "350px", width: "100%" }}>
            <ResponsiveContainer>
              <BarChart data={districtRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="district" />
                <Tooltip />
                <Bar dataKey="Watermelon" fill="#f59e0b" />
                <Bar dataKey="Durian" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>
    </div>
  );
}

function RankingsSection({ data }) {
  return (
    <article className="statistics-card">
      <div className="statistics-card-heading">
        <h2>Highest performing crops</h2>
      </div>
      <div className="crop-rank-list">
        {data.map((item) => (
          <div key={item.crop} className="crop-rank-item">
            <div className="crop-rank-topline">
              <strong> {item.crop}</strong>
              <span>{item.yield}</span>
            </div>
            <div className="crop-score-track">
              <span style={{ width: `${item.suitability}%` }} />
            </div>
            <p className="crop-meta">
              {item.suitability}% suitability in {item.districts}
            </p>
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
      </div>
      <div className="statistics-table-wrap">
        <table className="statistics-table">
          <thead>
            <tr>
              <th>District</th>
              <th>Watermelon</th>
              <th>Durian</th>
              <th>Cabbage</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.district}>
                <td>{row.district}</td>
                <td>{row.Watermelon}%</td>
                <td>{row.Durian}%</td>
                <td>{row.Cabbage}%</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
