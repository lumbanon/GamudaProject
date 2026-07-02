import { useEffect, useMemo, useState } from "react"
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { calculatePolygonAreaHectares, formatHectares } from "./predictionUtils"

const SABAH_CENTER = [5.62, 117.1]
const SABAH_VIEW_BOUNDS = [
  [3.85, 114.95],
  [7.65, 119.65],
]

export default function SatellitePlanningMap({ district, polygon, onPolygonChange, clearVersion }) {
  const [isDrawing, setIsDrawing] = useState(false)
  const [draftPoints, setDraftPoints] = useState([])

  const finalPositions = useMemo(() => geoJsonToLeafletPositions(polygon), [polygon])
  const draftPolygon = useMemo(() => leafletPositionsToGeoJson(draftPoints), [draftPoints])
  const draftArea = useMemo(() => calculatePolygonAreaHectares(draftPolygon), [draftPolygon])
  const canFinish = isDrawing && draftPoints.length >= 3
  const hasWork = isDrawing || Boolean(polygon?.length)

  function beginDrawing() {
    setDraftPoints([])
    setIsDrawing(true)
    onPolygonChange(null)
  }

  function addPoint(point) {
    setDraftPoints((current) => [...current, point])
  }

  function undoPoint() {
    setDraftPoints((current) => current.slice(0, -1))
  }

  function finishDrawing() {
    if (draftPoints.length < 3) return
    onPolygonChange(leafletPositionsToGeoJson(draftPoints))
    setDraftPoints([])
    setIsDrawing(false)
  }

  function clearArea() {
    setDraftPoints([])
    setIsDrawing(false)
    onPolygonChange(null)
  }

  return (
    <div className="satellite-map-shell">
      <MapContainer
        bounds={SABAH_VIEW_BOUNDS}
        center={SABAH_CENTER}
        zoom={8}
        minZoom={7}
        maxZoom={16}
        maxBounds={SABAH_VIEW_BOUNDS}
        maxBoundsViscosity={1}
        zoomControl={false}
        doubleClickZoom={false}
        scrollWheelZoom
        className="satellite-planning-map"
      >
        <TileLayer
          attribution="Tiles: Esri, Maxar, Earthstar Geographics, and the GIS user community"
          bounds={SABAH_VIEW_BOUNDS}
          noWrap
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        <DrawingEvents active={isDrawing} onAddPoint={addPoint} onFinish={finishDrawing} />
        <ZoomControl position="bottomright" />
        <MapResizeHandler watchKey={`${clearVersion}-${polygon?.length || 0}-${draftPoints.length}`} />

        {finalPositions.length > 0 && (
          <Polygon
            positions={finalPositions}
            pathOptions={{
              color: "#e5b83f",
              fillColor: "#7ac66f",
              fillOpacity: 0.26,
              opacity: 1,
              weight: 3,
            }}
          />
        )}

        {draftPoints.length > 1 && (
          <Polyline
            positions={draftPoints}
            pathOptions={{ color: "#f3c74f", opacity: 1, weight: 3, dashArray: "8 8" }}
          />
        )}

        {draftPoints.length >= 3 && (
          <Polygon
            positions={draftPoints}
            pathOptions={{
              color: "#f3c74f",
              fillColor: "#b9dc69",
              fillOpacity: 0.2,
              opacity: 0.92,
              weight: 2,
              dashArray: "8 8",
            }}
          />
        )}

        {draftPoints.map((point, index) => (
          <CircleMarker
            center={point}
            key={`${point[0]}-${point[1]}-${index}`}
            pathOptions={{ color: "#ffffff", fillColor: "#355e3b", fillOpacity: 1, weight: 2 }}
            radius={5}
          />
        ))}
      </MapContainer>

      <div className="map-instruction-chip">Draw your planting boundary on the map</div>

      <div className="map-drawing-toolbar" aria-label="Drawing controls">
        <button type="button" onClick={beginDrawing}>
          {polygon?.length ? "Redraw Area" : "Start Boundary"}
        </button>
        <button type="button" onClick={finishDrawing} disabled={!canFinish}>
          Finish Boundary
        </button>
        <button type="button" onClick={undoPoint} disabled={!draftPoints.length}>
          Undo Point
        </button>
        <button type="button" onClick={clearArea} disabled={!hasWork}>
          Clear Area
        </button>
      </div>

      <div className="map-area-chip">
        <span>Selected area</span>
        <strong>{formatHectares(polygon?.length ? calculatePolygonAreaHectares(polygon) : draftArea)}</strong>
      </div>

      {polygon?.length > 0 && (
        <div className="map-district-chip">
          <span>District</span>
          <strong>{district || "Not detected"}</strong>
        </div>
      )}
    </div>
  )
}

function DrawingEvents({ active, onAddPoint, onFinish }) {
  const map = useMapEvents({
    click(event) {
      if (!active) return
      onAddPoint([event.latlng.lat, event.latlng.lng])
    },
    dblclick(event) {
      if (!active) return
      event.originalEvent.preventDefault()
      onFinish()
    },
  })

  useEffect(() => {
    if (active) {
      map.doubleClickZoom.disable()
    } else {
      map.doubleClickZoom.enable()
    }

    return () => map.doubleClickZoom.enable()
  }, [active, map])

  return null
}

function MapResizeHandler({ watchKey }) {
  const map = useMap()

  useEffect(() => {
    const invalidate = () => map.invalidateSize({ animate: false })
    const frameId = window.requestAnimationFrame(invalidate)
    const timeoutId = window.setTimeout(invalidate, 260)
    window.addEventListener("resize", invalidate)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
      window.removeEventListener("resize", invalidate)
    }
  }, [map, watchKey])

  return null
}

function geoJsonToLeafletPositions(polygon) {
  if (!Array.isArray(polygon)) return []
  return polygon.map(([lon, lat]) => [lat, lon])
}

function leafletPositionsToGeoJson(points) {
  if (!Array.isArray(points) || points.length < 3) return []

  const coordinates = points.map(([lat, lon]) => [roundCoordinate(lon), roundCoordinate(lat)])
  const [firstLon, firstLat] = coordinates[0]
  const [lastLon, lastLat] = coordinates[coordinates.length - 1]

  if (firstLon !== lastLon || firstLat !== lastLat) {
    coordinates.push([firstLon, firstLat])
  }

  return coordinates
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(6))
}
