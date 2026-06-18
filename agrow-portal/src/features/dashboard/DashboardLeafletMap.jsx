import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from "react-leaflet";
import "./leaflet.css";
import sabahBoundary from "./sabahBoundary";
import sabahDistricts from "./sabahDistricts";

const SABAH_CENTER = [5.62, 117.1];
const SABAH_VIEW_BOUNDS = [
  [3.85, 114.95],
  [7.65, 119.65],
];

const cropNames = ["Corn", "Banana", "Cocoa"];

export function getDistrictSuitability(district = "Sandakan") {
  return cropNames.reduce((scores, crop) => {
    scores[crop] = getCropScore(district, crop);
    return scores;
  }, {});
}

export function getDistrictRainfall(district = "Sandakan") {
  if (district === "Sandakan") return 3200;
  return 1900 + (hashString(`${district}-rainfall`) % 1800);
}

function DashboardLeafletMap({ activeCrop, focusedDistrict, onDistrictSelect }) {
  const focusedFeature = useMemo(
    () => sabahDistricts.features.find((feature) => getDistrictName(feature) === focusedDistrict),
    [focusedDistrict],
  );
  const focusedCenter = useMemo(() => getFeatureCenter(focusedFeature), [focusedFeature]);

  return (
    <MapContainer
      bounds={SABAH_VIEW_BOUNDS}
      center={SABAH_CENTER}
      zoom={8}
      minZoom={7}
      maxZoom={13}
      maxBounds={SABAH_VIEW_BOUNDS}
      maxBoundsViscosity={1}
      zoomControl={false}
      scrollWheelZoom="center"
      className="dashboard-leaflet-map"
    >
      <ZoomControl position="bottomright" />
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        bounds={SABAH_VIEW_BOUNDS}
        noWrap
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <GeoJSON
        key={`districts-${activeCrop}-${focusedDistrict}`}
        data={sabahDistricts}
        style={(feature) => districtFeatureStyle(feature, activeCrop, focusedDistrict)}
        onEachFeature={(feature, layer) =>
          bindDistrictFeature(feature, layer, activeCrop, focusedDistrict, onDistrictSelect)
        }
      />

      <GeoJSON
        key="sabah-outline"
        data={sabahBoundary}
        interactive={false}
        style={{
          color: "#24552d",
          fillColor: "#93d7a3",
          fillOpacity: 0.05,
          opacity: 0.95,
          weight: 2.4,
        }}
      />

      {focusedCenter && (
        <CircleMarker
          center={focusedCenter}
          radius={8}
          pathOptions={{
            color: "#ffffff",
            fillColor: "#244b2c",
            fillOpacity: 1,
            opacity: 1,
            weight: 3,
          }}
        >
          <Tooltip
            className="dashboard-focus-tooltip"
            direction="top"
            offset={[0, -10]}
            permanent
          >
            {focusedDistrict}
          </Tooltip>
          <Popup>
            <DistrictPopup district={focusedDistrict} activeCrop={activeCrop} />
          </Popup>
        </CircleMarker>
      )}

      <SabahViewport />
      <MapResizeHandler watchKey={`${activeCrop}-${focusedDistrict}`} />
    </MapContainer>
  );
}

function DistrictPopup({ district, activeCrop }) {
  const score = getCropScore(district, activeCrop);

  return (
    <div className="dashboard-map-popup">
      <strong>{district}</strong>
      <span>{activeCrop} suitability: {score}%</span>
      <span>Yearly rainfall: {getDistrictRainfall(district)}mm</span>
    </div>
  );
}

function SabahViewport() {
  const map = useMap();

  useEffect(() => {
    map.fitBounds(SABAH_VIEW_BOUNDS, { animate: false, padding: [26, 26] });
    map.setMaxBounds(SABAH_VIEW_BOUNDS);
  }, [map]);

  return null;
}

function MapResizeHandler({ watchKey }) {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => map.invalidateSize({ animate: false });
    const frameId = window.requestAnimationFrame(invalidate);
    const timeoutId = window.setTimeout(invalidate, 250);
    window.addEventListener("resize", invalidate);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", invalidate);
    };
  }, [map, watchKey]);

  return null;
}

function bindDistrictFeature(feature, layer, activeCrop, focusedDistrict, onDistrictSelect) {
  const district = getDistrictName(feature);
  const score = getCropScore(district, activeCrop);
  const level = getSuitabilityLevel(score);

  layer.bindTooltip(district, {
    className: "dashboard-district-tooltip",
    sticky: true,
  });

  layer.bindPopup(
    `<div class="dashboard-map-popup">
      <strong>${escapeHtml(district)}</strong>
      <span>${escapeHtml(activeCrop)} suitability: ${score}%</span>
      <span>Suitability class: ${escapeHtml(level)}</span>
      <span>Yearly rainfall: ${getDistrictRainfall(district)}mm</span>
    </div>`,
  );

  layer.on({
    click() {
      onDistrictSelect(district);
    },
    mouseover() {
      layer.setStyle({
        fillOpacity: 0.78,
        opacity: 1,
        weight: 3,
      });
      layer.bringToFront();
    },
    mouseout() {
      layer.setStyle(districtFeatureStyle(feature, activeCrop, focusedDistrict));
    },
  });
}

function districtFeatureStyle(feature, activeCrop, focusedDistrict) {
  const district = getDistrictName(feature);
  const score = getCropScore(district, activeCrop);
  const selected = district === focusedDistrict;

  return {
    className: "dashboard-district-layer",
    color: selected ? "#173f20" : "#315f3a",
    fillColor: getSuitabilityColor(score),
    fillOpacity: selected ? 0.7 : 0.5,
    opacity: selected ? 1 : 0.82,
    weight: selected ? 3 : 1.4,
  };
}

function getDistrictName(feature) {
  return feature?.properties?.district || feature?.properties?.district_name || feature?.properties?.shapeName || "Unknown district";
}

function getCropScore(district, crop) {
  if (district === "Sandakan") return 60;

  const cropOffset = {
    Banana: 4,
    Corn: 0,
    Cocoa: -3,
  }[crop] || 0;

  return clamp(43 + (hashString(`${district}-${crop}`) % 43) + cropOffset, 35, 90);
}

function getSuitabilityLevel(score) {
  if (score >= 70) return "High suitability";
  if (score >= 50) return "Moderate";
  return "Low suitability";
}

function getSuitabilityColor(score) {
  if (score >= 70) return "#3d8b49";
  if (score >= 50) return "#f0be40";
  return "#d35b4c";
}

function getFeatureCenter(feature) {
  const coordinates = flattenCoordinates(feature?.geometry);
  if (!coordinates.length) return null;

  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  return [(south + north) / 2, (west + east) / 2];
}

function flattenCoordinates(geometry) {
  const coordinates = [];

  function walk(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      coordinates.push(value);
      return;
    }
    value.forEach(walk);
  }

  walk(geometry?.coordinates);
  return coordinates;
}

function hashString(value) {
  return Array.from(value).reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) >>> 0;
  }, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default DashboardLeafletMap;
