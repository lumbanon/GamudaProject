import React from "react";

export default function AlertPanel() {
  const alerts = [
    { type: "CRITICAL", text: "Pest In Zone 3", time: "2m ago" },
    { type: "WARNING", text: "Water Level Low - Zone 5", time: "15m ago" },
    { type: "INFO", text: "Weather Alert: Rain Predicted", time: "3h ago" },
  ];

  return (
    <aside className="alert-panel">
      <h3>Recent Alerts</h3>
      {alerts.map((alert, index) => (
        <div key={index} className={`alert-card ${alert.type.toLowerCase()}`}>
          <span>{alert.text}</span>
          <small>{alert.time}</small>
        </div>
      ))}
    </aside>
  );
}
