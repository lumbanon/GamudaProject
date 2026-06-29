import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export default function YieldTrendChart({ data }) {
  return (
    <div
      className="chart-container"
      style={{ background: "#fff", padding: "20px", borderRadius: "12px" }}
    >
      <h3>Yield Performance Trend</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="Banana"
            stroke="#2D8A48"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="Maize"
            stroke="#B87333"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="Soya"
            stroke="#8884d8"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
