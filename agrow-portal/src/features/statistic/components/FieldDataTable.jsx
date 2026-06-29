import React from "react";

export default function FieldDataTable({ data }) {
  return (
    <div
      className="table-container"
      style={{ background: "#fff", padding: "20px", borderRadius: "12px" }}
    >
      <h3>Secondary Data</h3>
      <table
        className="stats-table"
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
            <th>FIELD ID</th>
            <th>TEMP</th>
            <th>MOISTURE</th>
            <th>LAST ACTIVITY</th>
          </tr>
        </thead>
        <tbody>
          {data && data.length > 0 ? (
            data.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid #f9f9f9" }}>
                <td style={{ padding: "12px 0" }}>{row.id}</td>
                <td>{row.temp}</td>
                <td>{row.moisture}</td>
                <td>{row.activity}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="4">No data available</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
