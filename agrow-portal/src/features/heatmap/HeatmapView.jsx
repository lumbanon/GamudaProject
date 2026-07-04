import { useMemo, useState } from "react";
import sabahDistricts from "../dashboard/sabahDistricts";
import "./heatmap-view.css";

const cropData = {
  Banana: {
    score: 90,
    confidence: "90% (High)",
    metrics: [
      { label: "Rainfall", value: "2472.92 mm/year", status: "Good match", tone: "good" },
      { label: "Temperature", value: "27.03°C", status: "Good match", tone: "good" },
      { label: "Soil pH", value: "n/a", status: "Risk", tone: "risk" },
      { label: "Elevation", value: "9 m", status: "Good match", tone: "good" },
    ],
    notes:
      "Texture: medium, organic; Fertility: high; moderate; Drainage: well (dry spells); Salinity: low (<4 dS/m)",
  },
  Corn: {
    score: 78,
    confidence: "78% (Moderate)",
    metrics: [
      { label: "Rainfall", value: "2140.35 mm/year", status: "Good match", tone: "good" },
      { label: "Temperature", value: "26.81°C", status: "Good match", tone: "good" },
      { label: "Soil pH", value: "5.9", status: "Moderate", tone: "moderate" },
      { label: "Elevation", value: "22 m", status: "Good match", tone: "good" },
    ],
    notes:
      "Texture: loamy, medium; Fertility: moderate; Drainage: well drained; Salinity: low (<4 dS/m)",
  },
  Cocoa: {
    score: 48,
    confidence: "48% (Low)",
    metrics: [
      { label: "Rainfall", value: "1886.10 mm/year", status: "Risk", tone: "risk" },
      { label: "Temperature", value: "28.12°C", status: "Moderate", tone: "moderate" },
      { label: "Soil pH", value: "n/a", status: "Risk", tone: "risk" },
      { label: "Elevation", value: "35 m", status: "Good match", tone: "good" },
    ],
    notes:
      "Texture: medium clay; Fertility: moderate; Drainage: sensitive to dry spells; Salinity: low to moderate",
  },
};

const cropNames = Object.keys(cropData);
const districtFeatures = sabahDistricts.features || [];
const districtNames = getDistrictNames(districtFeatures);
const geoBounds = getGeoBounds(districtFeatures);

function HeatmapView() {
  const [selectedDistrict, setSelectedDistrict] = useState("Sandakan");
  const [comparisonCrop, setComparisonCrop] = useState("");
  const [comparisonList, setComparisonList] = useState(["Banana"]);
  const [locationState, setLocationState] = useState({
    status: "idle",
    message: "",
    coordinates: null,
  });

  const isLocating = locationState.status === "loading";
  const currentLocationPoint =
    locationState.coordinates && isCoordinateInBounds(locationState.coordinates, geoBounds)
      ? projectCoordinate(locationState.coordinates[0], locationState.coordinates[1], geoBounds)
      : null;

  const mapPaths = useMemo(
    () =>
      districtFeatures.map((feature, index) => {
        const district = getDistrictName(feature);
        const score = getDistrictSuitability(district);

        return {
          id: `${district}-${index}`,
          district,
          score,
          path: geometryToPath(feature.geometry, geoBounds),
          className: getSuitabilityClass(score),
        };
      }),
    [],
  );

  function handleAddCrop() {
    if (!comparisonCrop || comparisonList.includes(comparisonCrop)) return;
    setComparisonList((current) => [...current, comparisonCrop]);
    setComparisonCrop("");
  }

  function handleRemoveCrop(crop) {
    setComparisonList((current) => current.filter((item) => item !== crop));
  }

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationState({
        status: "error",
        message: "Geolocation is not available in this browser.",
        coordinates: null,
      });
      return;
    }

    setLocationState({
      status: "loading",
      message: "Finding your current location...",
      coordinates: null,
    });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = [position.coords.longitude, position.coords.latitude];
        const districtFeature = findDistrictByCoordinate(coordinates, districtFeatures);

        if (!districtFeature) {
          setLocationState({
            status: "error",
            message: "Your current location is outside the Sabah district map.",
            coordinates,
          });
          return;
        }

        const district = getDistrictName(districtFeature);
        setSelectedDistrict(district);
        setLocationState({
          status: "success",
          message: `Detected ${district} from your current location.`,
          coordinates,
        });
      },
      (error) => {
        setLocationState({
          status: "error",
          message: getLocationErrorMessage(error),
          coordinates: null,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 300000,
      },
    );
  }

  return (
    <div className="heatmap-page">
      <div className="heatmap-shell">
        <section className="heatmap-card heatmap-map-card" aria-label="District Details">
          <div className="heatmap-card-heading">
            <h1>District Details</h1>
          </div>

          <div className="heatmap-controls">
            <label className="district-select-wrap">
              <span className="sr-only">District</span>
              <select
                value={selectedDistrict}
                onChange={(event) => setSelectedDistrict(event.target.value)}
              >
                {districtNames.map((district) => (
                  <option key={district} value={district}>
                    {district === selectedDistrict ? `${district} ×` : district}
                  </option>
                ))}
              </select>
            </label>

            <button className="location-button" type="button" onClick={handleUseCurrentLocation} disabled={isLocating}>
              <LocationIcon />
              <span>{isLocating ? "Locating..." : "Use My Current Location"}</span>
            </button>
          </div>

          {locationState.message && (
            <p className={`location-status ${locationState.status}`} aria-live="polite">
              {locationState.message}
            </p>
          )}

          <div className="heatmap-map-area">
            <div className="heatmap-map-frame">
              <svg
                className="sabah-heatmap-svg"
                viewBox="0 0 900 540"
                role="img"
                aria-label="Sabah district crop suitability heatmap"
              >
                <rect className="map-water" x="0" y="0" width="900" height="540" rx="28" />
                <g className="district-map-group">
                  {mapPaths.map((district) => (
                    <path
                      key={district.id}
                      d={district.path}
                      className={[
                        "district-shape",
                        district.className,
                        district.district === selectedDistrict ? "selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedDistrict(district.district)}
                    >
                      <title>{district.district}</title>
                    </path>
                  ))}
                </g>

                {currentLocationPoint && (
                  <g className="current-location-marker" aria-label="Current location marker">
                    <circle className="location-marker-pulse" cx={currentLocationPoint[0]} cy={currentLocationPoint[1]} r="16" />
                    <circle className="location-marker-dot" cx={currentLocationPoint[0]} cy={currentLocationPoint[1]} r="6" />
                  </g>
                )}
              </svg>

              <div className="heatmap-legend" aria-label="Suitability legend">
                <div>
                  <i className="legend-dot high" />
                  <span>High suitability (&gt;80%)</span>
                </div>
                <div>
                  <i className="legend-dot moderate" />
                  <span>Moderate (50-80%)</span>
                </div>
                <div>
                  <i className="legend-dot low" />
                  <span>Low suitability (&lt;50%)</span>
                </div>
              </div>

              <div className="map-sparkle" aria-hidden="true">
                <SparkleIcon />
              </div>
            </div>
          </div>
        </section>

        <div className="heatmap-section-stack">
          <section className="heatmap-card prediction-card" aria-label="Prediction">
            <h2>PREDICTION</h2>
            <div className="recommendation-box">
              <span>Recommended crop</span>
              <strong>Banana</strong>
              <small>Confidence 90% (High)</small>
            </div>

            <div className="prediction-bars">
              {cropNames.map((crop) => (
                <ProgressBar key={crop} label={crop} value={cropData[crop].score} />
              ))}
            </div>
          </section>

          <section className="heatmap-card comparison-card" aria-label="Crop Comparison">
            <h2>CROP COMPARISON</h2>
            <div className="comparison-controls">
              <select
                value={comparisonCrop}
                onChange={(event) => setComparisonCrop(event.target.value)}
              >
                <option value="">Select crop to compare</option>
                {cropNames.map((crop) => (
                  <option key={crop} value={crop}>
                    {crop}
                  </option>
                ))}
              </select>
              <button type="button" onClick={handleAddCrop} disabled={!comparisonCrop}>
                Add
              </button>
            </div>

            <div className="comparison-list">
              {comparisonList.map((crop) => (
                <CropComparisonPanel
                  key={crop}
                  crop={crop}
                  data={cropData[crop]}
                  onRemove={() => handleRemoveCrop(crop)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ label, value }) {
  return (
    <div className="prediction-progress">
      <div className="progress-label-row">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function CropComparisonPanel({ crop, data, onRemove }) {
  return (
    <article className="crop-comparison-panel">
      <div className="comparison-panel-header">
        <strong>{crop}</strong>
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      </div>

      <div className="metric-grid">
        {data.metrics.map((metric) => (
          <div className="metric-box" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small className={metric.tone}>{metric.status}</small>
          </div>
        ))}
      </div>

      <p className="comparison-notes">{data.notes}</p>
    </article>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="9" r="2.4" fill="currentColor" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l2.4 6.7L21 11l-6.6 2.3L12 20l-2.4-6.7L3 11l6.6-2.3L12 2Z" />
      <path d="M19 3l.9 2.4L22 6.2l-2.1.8L19 9.4l-.9-2.4L16 6.2l2.1-.8L19 3Z" />
    </svg>
  );
}

function getDistrictNames(features) {
  const names = features.map(getDistrictName).filter(Boolean);
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

function getDistrictName(feature) {
  return (
    feature?.properties?.district ||
    feature?.properties?.district_name ||
    feature?.properties?.shapeName ||
    "Unknown district"
  );
}

function getDistrictSuitability(district) {
  if (district === "Sandakan") return 90;
  if (district === "Kinabatangan") return 84;
  if (district === "Tawau") return 72;
  if (district === "Kota Kinabalu") return 58;
  return 38 + (hashString(district) % 57);
}

function getSuitabilityClass(score) {
  if (score > 80) return "high";
  if (score >= 50) return "moderate";
  return "low";
}

function findDistrictByCoordinate(coordinates, features) {
  return features.find((feature) => pointInFeature(coordinates, feature));
}

function pointInFeature(point, feature) {
  const geometry = feature?.geometry;
  if (!geometry) return false;

  if (geometry.type === "Polygon") {
    return pointInPolygonCoordinates(point, geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygonCoordinates) => pointInPolygonCoordinates(point, polygonCoordinates));
  }

  return false;
}

function pointInPolygonCoordinates(point, polygonCoordinates) {
  const [outerRing, ...holes] = polygonCoordinates || [];
  if (!outerRing || !pointInRing(point, outerRing)) return false;

  return !holes.some((ring) => pointInRing(point, ring));
}

function pointInRing([lon, lat], ring) {
  let inside = false;

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLon, currentLat] = ring[current];
    const [previousLon, previousLat] = ring[previous];
    const crossesLatitude = currentLat > lat !== previousLat > lat;
    const intersectionLon = ((previousLon - currentLon) * (lat - currentLat)) / (previousLat - currentLat) + currentLon;

    if (crossesLatitude && lon < intersectionLon) inside = !inside;
  }

  return inside;
}

function isCoordinateInBounds([lon, lat], bounds) {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function getLocationErrorMessage(error) {
  if (error?.code === 1) {
    return "Location permission was denied. Allow location access and try again.";
  }

  if (error?.code === 2) {
    return "Your current location is unavailable right now.";
  }

  if (error?.code === 3) {
    return "Location lookup timed out. Try again in a moment.";
  }

  return "Unable to access your current location.";
}

function getGeoBounds(features) {
  const coordinates = features.flatMap((feature) => flattenCoordinates(feature.geometry));
  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);

  return {
    west: Math.min(...lons),
    east: Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

function geometryToPath(geometry, bounds) {
  if (!geometry) return "";

  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

  return polygons
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map(([lon, lat], index) => {
              const [x, y] = projectCoordinate(lon, lat, bounds);
              return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(" ")
            .concat(" Z"),
        )
        .join(" "),
    )
    .join(" ");
}

function projectCoordinate(lon, lat, bounds) {
  const width = 900;
  const height = 540;
  const padding = 38;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const boundsWidth = bounds.east - bounds.west || 1;
  const boundsHeight = bounds.north - bounds.south || 1;
  const scale = Math.min(usableWidth / boundsWidth, usableHeight / boundsHeight);
  const mapWidth = boundsWidth * scale;
  const mapHeight = boundsHeight * scale;
  const offsetX = (width - mapWidth) / 2;
  const offsetY = (height - mapHeight) / 2;

  const x = offsetX + (lon - bounds.west) * scale;
  const y = offsetY + (bounds.north - lat) * scale;
  return [x, y];
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

export default HeatmapView;
