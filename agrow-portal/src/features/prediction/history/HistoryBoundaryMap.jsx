import { useEffect, useMemo } from "react"
import { MapContainer, Polygon, TileLayer, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"

const DEFAULT_CENTER = [5.62, 117.1]

export default function HistoryBoundaryMap({ boundary }) {
  const positions = useMemo(() => {
    if (!Array.isArray(boundary)) return []
    const points = boundary.map(([longitude, latitude]) => [latitude, longitude])
    if (
      points.length > 1 &&
      points[0][0] === points[points.length - 1][0] &&
      points[0][1] === points[points.length - 1][1]
    ) {
      return points.slice(0, -1)
    }
    return points
  }, [boundary])

  return (
    <div
      id="saved-boundary-map"
      className="history-boundary-map"
      aria-label="Saved historical boundary map"
    >
      <MapContainer
        center={positions[0] || DEFAULT_CENTER}
        zoom={10}
        scrollWheelZoom
        className="history-leaflet-map"
      >
        <TileLayer
          attribution="Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
          crossOrigin="anonymous"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        {positions.length >= 3 && (
          <Polygon
            positions={positions}
            pathOptions={{
              color: "#e5b83f",
              fillColor: "#7ac66f",
              fillOpacity: 0.28,
              weight: 3,
            }}
          />
        )}
        <HistoryMapFitter positions={positions} />
      </MapContainer>
    </div>
  )
}

function HistoryMapFitter({ positions }) {
  const map = useMap()

  useEffect(() => {
    if (positions.length >= 3) {
      map.fitBounds(positions, { padding: [32, 32], maxZoom: 16 })
    }
  }, [map, positions])

  return null
}
