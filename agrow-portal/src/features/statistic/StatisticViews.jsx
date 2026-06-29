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
    value: "Banana",
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
          <span className="statistics-eyebrow">
            Comprehensive Crop Analytics
          </span>
          <h1>Sabah Agricultural Production Dashboard</h1>
          <p>
            Real-time monitoring of crop suitability, seasonal trends, and
            district-level performance metrics.
          </p>
        </div>
        <div className="statistics-hero-badge">
          <span>LIVE SYSTEM</span>
        </div>
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
                  dataKey="banana"
                  stroke="#f59e0b"
                  strokeWidth={3}
                />
                <Line
                  type="monotone"
                  dataKey="corn"
                  stroke="#10b981"
                  strokeWidth={3}
                />
                <Line
                  type="monotone"
                  dataKey="cocoa"
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
                <Bar dataKey="banana" fill="#f59e0b" />
                <Bar dataKey="corn" fill="#10b981" />
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
