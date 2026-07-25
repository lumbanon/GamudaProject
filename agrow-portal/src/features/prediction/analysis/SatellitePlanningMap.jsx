import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import L from "leaflet"
import html2canvas from "html2canvas"
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
import {
  addPolygonPoint,
  calculatePolygonAreaHectares,
  closePolygon,
  findDistrictForPoint,
  formatHectares,
  replacePolygonPoint,
  validatePolygonGeometry,
} from "./predictionUtils"
import {
  accuracyWarning,
  coordinateFromPosition,
  geolocationErrorMessage,
  requestCurrentPosition,
} from "./predictionGeolocation"

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

const gpsVertexIcon = L.divIcon({
  className: "polygon-vertex-marker polygon-vertex-marker-gps",
  html: '<span class="polygon-vertex-dot"></span>',
  iconAnchor: [19, 19],
  iconSize: [38, 38],
})

const SatellitePlanningMap = forwardRef(function SatellitePlanningMap({
  district,
  districtGeoJson = null,
  polygon,
  onPolygonChange,
  clearVersion,
  fitBoundaryVersion = 0,
  isBlocked = false,
  isVisible = true,
  reservedForestGeoJson = null,
}, ref) {
  const [isDrawing, setIsDrawing] = useState(false)
  const [draftPoints, setDraftPoints] = useState([])
  const [boundaryError, setBoundaryError] = useState("")
  const [locationFeedback, setLocationFeedback] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [gpsPoint, setGpsPoint] = useState(null)
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const captureAreaRef = useRef(null)
  const draftPointsRef = useRef([])

  const finalPositions = useMemo(() => geoJsonToLeafletPositions(polygon), [polygon])
  const draftPolygon = useMemo(() => leafletPositionsToGeoJson(draftPoints), [draftPoints])
  const draftArea = useMemo(() => calculatePolygonAreaHectares(draftPolygon), [draftPolygon])
  const reserveOverlayKey = useMemo(
    () => (reservedForestGeoJson ? JSON.stringify(reservedForestGeoJson) : "no-reserve-overlay"),
    [reservedForestGeoJson],
  )
  const canFinish = isDrawing && draftPoints.length >= 3
  const hasWork = isDrawing || Boolean(polygon?.length)

  const registerCaptureHandler = useCallback((handler) => {
    captureAreaRef.current = handler
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      async captureSelectedArea() {
        if (!polygon?.length || !captureAreaRef.current) return null
        return captureAreaRef.current()
      },
    }),
    [polygon],
  )

  function beginDrawing() {
    draftPointsRef.current = []
    setDraftPoints([])
    setIsDrawing(true)
    setBoundaryError("")
    setLocationFeedback(null)
    setGpsPoint(null)
    setGpsAccuracy(null)
    onPolygonChange(null)
  }

  const addPoint = useCallback((point) => {
    const result = addPolygonPoint(
      leafletPositionsToOpenGeoJson(draftPointsRef.current),
      leafletPointToGeoJson(point),
    )
    if (result.error) {
      setBoundaryError(result.error)
      return false
    }

    const nextPoints = openGeoJsonToLeafletPositions(result.points)
    draftPointsRef.current = nextPoints
    setDraftPoints(nextPoints)
    setBoundaryError("")
    return true
  }, [])

  const undoPoint = useCallback(() => {
    setDraftPoints((current) => {
      const removedPoint = current[current.length - 1]
      if (gpsPoint && leafletPointsEqual(removedPoint, gpsPoint)) {
        setGpsPoint(null)
        setGpsAccuracy(null)
        setLocationFeedback(null)
      }
      const nextPoints = current.slice(0, -1)
      draftPointsRef.current = nextPoints
      return nextPoints
    })
    setBoundaryError("")
  }, [gpsPoint])

  const moveDraftPoint = useCallback((index, latlng) => {
    setDraftPoints((current) => {
      const result = replacePolygonPoint(
        leafletPositionsToOpenGeoJson(current),
        index,
        [roundCoordinate(latlng.lng), roundCoordinate(latlng.lat)],
      )
      if (result.error) {
        setBoundaryError(result.error)
        return current
      }
      const nextPoints = openGeoJsonToLeafletPositions(result.points)
      draftPointsRef.current = nextPoints
      setBoundaryError("")
      return nextPoints
    })
  }, [])

  const moveFinalPoint = useCallback(
    (index, latlng) => {
      const result = replacePolygonPoint(
        leafletPositionsToOpenGeoJson(finalPositions),
        index,
        [roundCoordinate(latlng.lng), roundCoordinate(latlng.lat)],
      )
      if (result.error) {
        setBoundaryError(result.error)
        return
      }
      setBoundaryError("")
      onPolygonChange(closePolygon(result.points))
    },
    [finalPositions, onPolygonChange],
  )

  function finishDrawing() {
    const currentDraftPoints = draftPointsRef.current
    if (currentDraftPoints.length < 3) return
    const coordinates = leafletPositionsToOpenGeoJson(currentDraftPoints)
    const validation = validatePolygonGeometry(coordinates)
    if (!validation.valid) {
      setBoundaryError(validation.message)
      return
    }

    onPolygonChange(closePolygon(coordinates))
    draftPointsRef.current = []
    setDraftPoints([])
    setIsDrawing(false)
    setBoundaryError("")
  }

  function clearArea() {
    draftPointsRef.current = []
    setDraftPoints([])
    setIsDrawing(false)
    setBoundaryError("")
    setLocationFeedback(null)
    setGpsPoint(null)
    setGpsAccuracy(null)
    onPolygonChange(null)
  }

  async function addCurrentLocationPoint() {
    if (!isDrawing) beginDrawing()

    setLocationLoading(true)
    setLocationFeedback(null)
    setBoundaryError("")

    try {
      const coordinate = coordinateFromPosition(await requestCurrentPosition())
      const districtName = findDistrictForPoint(
        [coordinate.longitude, coordinate.latitude],
        districtGeoJson?.features || [],
      )
      if (!districtName) {
        setLocationFeedback({
          tone: "error",
          message: "Your current location is outside Sabah and was not added.",
        })
        return
      }

      const point = [coordinate.latitude, coordinate.longitude]
      if (!addPoint(point)) return

      setGpsPoint(point)
      setGpsAccuracy(coordinate.accuracy)
      const warning = accuracyWarning(coordinate.accuracy)
      setLocationFeedback(
        warning
          ? { tone: "warning", message: warning }
          : { tone: "success", message: "Current location added to the boundary." },
      )
    } catch (error) {
      setLocationFeedback({ tone: "error", message: geolocationErrorMessage(error) })
    } finally {
      setLocationLoading(false)
    }
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
          attribution="Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
          bounds={SABAH_VIEW_BOUNDS}
          crossOrigin="anonymous"
          noWrap
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        {districtGeoJson && (
          <GeoJSON
            data={districtGeoJson}
            interactive={false}
            style={{
              color: "#ffffff",
              fillOpacity: 0,
              opacity: 0.86,
              weight: 1.35,
              dashArray: "5 5",
            }}
          />
        )}

        <DrawingEvents
          active={isDrawing && !locationLoading}
          onAddPoint={addPoint}
          onFinish={finishDrawing}
        />
        <ZoomControl position="bottomright" />
        <MapResizeHandler
          watchKey={`${clearVersion}-${polygon?.length || 0}-${draftPoints.length}-${isVisible}`}
        />
        <RestoredBoundaryMapController
          fitVersion={fitBoundaryVersion}
          isVisible={isVisible}
          positions={finalPositions}
        />
        <MapCaptureController polygon={polygon} onCaptureReady={registerCaptureHandler} />
        {gpsPoint && <CurrentLocationMapController point={gpsPoint} />}

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
            icon={gpsPoint && leafletPointsEqual(point, gpsPoint) ? gpsVertexIcon : draftVertexIcon}
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
        <button type="button" onClick={addCurrentLocationPoint} disabled={locationLoading}>
          {locationLoading ? "Getting location..." : "Add Current Location Point"}
        </button>
        <button type="button" onClick={clearArea} disabled={!hasWork}>
          Clear Area
        </button>
      </div>

      {(boundaryError || locationFeedback || gpsAccuracy !== null) && (
        <div className="map-boundary-feedback" aria-live="polite">
          {boundaryError && <p className="map-boundary-feedback-error">{boundaryError}</p>}
          {locationFeedback && (
            <p className={`map-boundary-feedback-${locationFeedback.tone}`}>
              {locationFeedback.message}
            </p>
          )}
          {gpsAccuracy !== null && (
            <small>Reported GPS accuracy: ±{Math.round(gpsAccuracy)} m</small>
          )}
        </div>
      )}

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
})

export default SatellitePlanningMap

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
    let frameId = 0
    const scheduleInvalidate = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(invalidate)
    }

    scheduleInvalidate()
    const timeoutId = window.setTimeout(invalidate, 260)
    const mapContainer = map.getContainer()
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleInvalidate)

    resizeObserver?.observe(mapContainer)
    window.addEventListener("resize", scheduleInvalidate)
    window.visualViewport?.addEventListener("resize", scheduleInvalidate)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
      resizeObserver?.disconnect()
      window.removeEventListener("resize", scheduleInvalidate)
      window.visualViewport?.removeEventListener("resize", scheduleInvalidate)
    }
  }, [map, watchKey])

  return null
}

function CurrentLocationMapController({ point }) {
  const map = useMap()

  useEffect(() => {
    map.flyTo(point, Math.max(map.getZoom(), 15), {
      animate: true,
      duration: 0.8,
    })
  }, [map, point])

  return null
}

function RestoredBoundaryMapController({
  fitVersion,
  isVisible,
  positions,
}) {
  const map = useMap()
  const lastFitVersionRef = useRef(0)

  useEffect(() => {
    if (
      !fitVersion ||
      !isVisible ||
      positions.length < 3 ||
      lastFitVersionRef.current === fitVersion
    ) {
      return undefined
    }

    lastFitVersionRef.current = fitVersion

    const frameId = window.requestAnimationFrame(() => {
      map.invalidateSize({ animate: false })
      map.fitBounds(positions, {
        animate: false,
        maxZoom: 16,
        padding: [36, 36],
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [fitVersion, isVisible, map, positions])

  return null
}

function MapCaptureController({ polygon, onCaptureReady }) {
  const map = useMap()

  useEffect(() => {
    if (!polygon?.length) {
      onCaptureReady(null)
      return undefined
    }

    onCaptureReady(() => capturePolygonImage(map, polygon))
    return () => onCaptureReady(null)
  }, [map, onCaptureReady, polygon])

  return null
}

async function capturePolygonImage(map, polygon) {
  const positions = geoJsonToLeafletPositions(polygon)
  if (positions.length < 3) return null

  const previousCenter = map.getCenter()
  const previousZoom = map.getZoom()
  const bounds = L.latLngBounds(positions)

  try {
    await moveMapAndWait(map, () => {
      map.fitBounds(bounds, { animate: false, maxZoom: 16, padding: [36, 36] })
    })
    await waitForTileLayers(map)

    const container = map.getContainer()
    const polygonPoints = positions.map(([lat, lon]) =>
      map.latLngToContainerPoint(L.latLng(lat, lon)),
    )
    const fullCanvas = await html2canvas(container, {
      backgroundColor: "#101510",
      logging: false,
      scale: 1,
      useCORS: true,
      ignoreElements(element) {
        return Boolean(
          element?.classList?.contains("leaflet-control-container") ||
            element?.classList?.contains("leaflet-marker-pane") ||
            element?.classList?.contains("leaflet-overlay-pane") ||
            element?.classList?.contains("leaflet-tooltip-pane") ||
            element?.classList?.contains("leaflet-popup-pane"),
        )
      },
    })

    return cropAndMaskPolygon(fullCanvas, container, polygonPoints)
  } finally {
    map.setView(previousCenter, previousZoom, { animate: false })
  }
}

function cropAndMaskPolygon(fullCanvas, mapContainer, polygonPoints) {
  const scaleX = fullCanvas.width / Math.max(1, mapContainer.clientWidth)
  const scaleY = fullCanvas.height / Math.max(1, mapContainer.clientHeight)
  const padding = 18
  const minX = Math.max(0, Math.min(...polygonPoints.map((point) => point.x)) - padding)
  const minY = Math.max(0, Math.min(...polygonPoints.map((point) => point.y)) - padding)
  const maxX = Math.min(mapContainer.clientWidth, Math.max(...polygonPoints.map((point) => point.x)) + padding)
  const maxY = Math.min(mapContainer.clientHeight, Math.max(...polygonPoints.map((point) => point.y)) + padding)

  const sourceX = Math.floor(minX * scaleX)
  const sourceY = Math.floor(minY * scaleY)
  const sourceWidth = Math.max(1, Math.ceil((maxX - minX) * scaleX))
  const sourceHeight = Math.max(1, Math.ceil((maxY - minY) * scaleY))
  const output = document.createElement("canvas")
  output.width = sourceWidth
  output.height = sourceHeight

  const context = output.getContext("2d")
  context.fillStyle = "#101510"
  context.fillRect(0, 0, output.width, output.height)
  context.save()
  drawPolygonPath(context, polygonPoints, minX, minY, scaleX, scaleY)
  context.clip()
  context.drawImage(
    fullCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  )
  context.restore()

  drawPolygonPath(context, polygonPoints, minX, minY, scaleX, scaleY)
  context.strokeStyle = "#f4c84a"
  context.lineWidth = 3
  context.stroke()
  return output.toDataURL("image/jpeg", 0.86)
}

function drawPolygonPath(context, points, minX, minY, scaleX, scaleY) {
  context.beginPath()
  points.forEach((point, index) => {
    const x = (point.x - minX) * scaleX
    const y = (point.y - minY) * scaleY
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.closePath()
}

function moveMapAndWait(map, action) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      map.off("moveend", finish)
      window.clearTimeout(timeoutId)
      resolve()
    }
    const timeoutId = window.setTimeout(finish, 600)
    map.once("moveend", finish)
    action()
  })
}

async function waitForTileLayers(map) {
  const waits = []
  map.eachLayer((layer) => {
    if (!(layer instanceof L.TileLayer) || !layer.isLoading()) return
    waits.push(
      new Promise((resolve) => {
        const timeoutId = window.setTimeout(resolve, 3500)
        layer.once("load", () => {
          window.clearTimeout(timeoutId)
          resolve()
        })
      }),
    )
  })
  await Promise.all(waits)
  await new Promise((resolve) => window.setTimeout(resolve, 120))
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

function leafletPositionsToOpenGeoJson(points) {
  return points.map(([lat, lon]) => [roundCoordinate(lon), roundCoordinate(lat)])
}

function openGeoJsonToLeafletPositions(points) {
  return points.map(([lon, lat]) => [lat, lon])
}

function leafletPointToGeoJson([lat, lon]) {
  return [roundCoordinate(lon), roundCoordinate(lat)]
}

function leafletPointsEqual(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    Math.abs(first[0] - second[0]) < 1e-9 &&
    Math.abs(first[1] - second[1]) < 1e-9
  )
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(6))
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
