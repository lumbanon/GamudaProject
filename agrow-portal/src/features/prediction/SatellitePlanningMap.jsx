import { useCallback, useEffect, useMemo, useState } from "react"
import L from "leaflet"
import {
  GeoJSON,
  MapContainer,
  Marker,
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

const draftVertexIcon = L.divIcon({
  className: "polygon-vertex-marker polygon-vertex-marker-draft",
  html: '<span class="polygon-vertex-dot"></span>',
  iconAnchor: [19, 19],
  iconSize: [38, 38],
})

const finalVertexIcon = L.divIcon({
  className: "polygon-vertex-marker polygon-vertex-marker-final",
  html: '<span class="polygon-vertex-dot"></span>',
  iconAnchor: [19, 19],
  iconSize: [38, 38],
})

export default function SatellitePlanningMap({
  district,
  polygon,
  onPolygonChange,
  clearVersion,
  isBlocked = false,
  reservedForestGeoJson = null,
}) {
  const [isDrawing, setIsDrawing] = useState(false)
  const [draftPoints, setDraftPoints] = useState([])

  const finalPositions = useMemo(() => geoJsonToLeafletPositions(polygon), [polygon])
  const draftPolygon = useMemo(() => leafletPositionsToGeoJson(draftPoints), [draftPoints])
  const draftArea = useMemo(() => calculatePolygonAreaHectares(draftPolygon), [draftPolygon])
  const reserveOverlayKey = useMemo(
    () => (reservedForestGeoJson ? JSON.stringify(reservedForestGeoJson) : "no-reserve-overlay"),
    [reservedForestGeoJson],
  )
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

  const undoPoint = useCallback(() => {
    setDraftPoints((current) => current.slice(0, -1))
  }, [])

  const moveDraftPoint = useCallback((index, latlng) => {
    setDraftPoints((current) =>
      current.map((point, pointIndex) => (pointIndex === index ? latLngToPoint(latlng) : point)),
    )
  }, [])

  const moveFinalPoint = useCallback(
    (index, latlng) => {
      const nextPositions = finalPositions.map((point, pointIndex) =>
        pointIndex === index ? latLngToPoint(latlng) : point,
      )
      onPolygonChange(leafletPositionsToGeoJson(nextPositions))
    },
    [finalPositions, onPolygonChange],
  )

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

  useEffect(() => {
    if (!isDrawing) return undefined

    function handleKeyDown(event) {
      if (!isUndoShortcut(event) || isTypingTarget(event.target)) return

      event.preventDefault()
      undoPoint()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isDrawing, undoPoint])

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

        {reservedForestGeoJson && (
          <GeoJSON
            data={reservedForestGeoJson}
            key={reserveOverlayKey}
            style={{
              color: "#5f6962",
              fillColor: "#79827b",
              fillOpacity: 0.32,
              opacity: 0.88,
              weight: 2,
              dashArray: "7 7",
            }}
          />
        )}

        {finalPositions.length > 0 && (
          <Polygon
            positions={finalPositions}
            pathOptions={
              isBlocked
                ? {
                    color: "#b42318",
                    fillColor: "#e5483e",
                    fillOpacity: 0.34,
                    opacity: 1,
                    weight: 4,
                  }
                : {
                    color: "#e5b83f",
                    fillColor: "#7ac66f",
                    fillOpacity: 0.26,
                    opacity: 1,
                    weight: 3,
                  }
            }
          />
        )}

        {finalPositions.map((point, index) => (
          <VertexMarker
            icon={finalVertexIcon}
            index={index}
            key={`final-${index}`}
            point={point}
            onMove={moveFinalPoint}
          />
        ))}

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
          <VertexMarker
            icon={draftVertexIcon}
            index={index}
            key={`draft-${index}`}
            point={point}
            onMove={moveDraftPoint}
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
          Undo last point
        </button>
        <button type="button" onClick={clearArea} disabled={!hasWork}>
          Clear Area
        </button>
      </div>

      <div className="map-area-chip">
        <span className="map-chip-label">Selected area</span>
        <span className="map-chip-value">{formatHectares(polygon?.length ? calculatePolygonAreaHectares(polygon) : draftArea)}</span>
      </div>

      {polygon?.length > 0 && (
        <div className="map-district-chip">
          <span className="map-chip-label">District</span>
          <span className="map-chip-value">{district || "Not detected"}</span>
        </div>
      )}

      {isBlocked && (
        <div className="map-reserve-chip">
          <span className="map-chip-label">Reserved forest</span>
          <span className="map-chip-value">Planting blocked</span>
        </div>
      )}
    </div>
  )
}

function VertexMarker({ icon, index, point, onMove }) {
  return (
    <Marker
      autoPan
      bubblingMouseEvents={false}
      draggable
      icon={icon}
      position={point}
      eventHandlers={{
        drag(event) {
          onMove(index, event.target.getLatLng())
        },
        dragend(event) {
          onMove(index, event.target.getLatLng())
        },
      }}
    />
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

  const positions = polygon.map(([lon, lat]) => [lat, lon])
  const firstPoint = positions[0]
  const lastPoint = positions[positions.length - 1]

  if (
    positions.length > 1 &&
    Array.isArray(firstPoint) &&
    Array.isArray(lastPoint) &&
    firstPoint[0] === lastPoint[0] &&
    firstPoint[1] === lastPoint[1]
  ) {
    return positions.slice(0, -1)
  }

  return positions
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

function latLngToPoint(latlng) {
  return [roundCoordinate(latlng.lat), roundCoordinate(latlng.lng)]
}

function isUndoShortcut(event) {
  return (
    String(event.key).toLowerCase() === "z" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  )
}

function isTypingTarget(target) {
  if (!target || typeof target.closest !== "function") return false

  const tagName = String(target.tagName || "").toLowerCase()
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
  )
}
