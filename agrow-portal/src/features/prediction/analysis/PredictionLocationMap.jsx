import { useEffect, useMemo, useRef, useState } from "react"
import GooglePlaceSearch from "./GooglePlaceSearch"
import GoogleBoundaryLayer from "./GoogleBoundaryLayer"
import GoogleSabahMask from "./GoogleSabahMask"
import sabahDisplayRegion from "./data/sabah-display-region.json"
import { googlePath, loadGoogleMaps, openBoundary, SABAH_CENTER } from "./googleMaps"
import { addPolygonPoint, calculatePolygonAreaHectares, closePolygon, findDistrictForPoint, formatHectares, validatePolygonGeometry } from "./predictionUtils"
import { accuracyWarning, coordinateFromPosition, geolocationErrorMessage, requestCurrentPosition } from "./predictionGeolocation"
import "./google-planning-map.css"

export default function PredictionLocationMap({
  district, districtGeoJson, polygon, onPolygonChange, fitBoundaryVersion = 0,
  isVisible = true, isBlocked = false, reservedForestGeoJson,
}) {
  const containerRef = useRef(null)
  const handlersRef = useRef({})
  const [api, setApi] = useState(null)
  const [mapError, setMapError] = useState("")
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState([])
  const draftRef = useRef([])
  const [feedback, setFeedback] = useState("")
  const [editVersion, setEditVersion] = useState(0)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [showRegionShading, setShowRegionShading] = useState(true)
  const operationRef = useRef(0)
  const lastFitRef = useRef(0)
  const initialFitRef = useRef(false)
  const points = useMemo(() => drawing ? draft : openBoundary(polygon), [drawing, draft, polygon])
  const disabled = !api || Boolean(mapError)

  function setDraftPoints(next) { draftRef.current = next; setDraft(next) }
  function beginDrawing() {
    operationRef.current += 1
    setDraftPoints([]); setDrawing(true); setFeedback(""); onPolygonChange(null)
  }
  function addPoint(point) {
    const result = addPolygonPoint(draftRef.current, point)
    if (result.error) { setFeedback(result.error); return false }
    setDraftPoints(result.points); setFeedback(""); return true
  }
  function finishDrawing() {
    const result = validatePolygonGeometry(draftRef.current)
    if (!result.valid) { setFeedback(result.message); return }
    onPolygonChange(closePolygon(draftRef.current)); setDrawing(false); setDraftPoints([]); setFeedback("")
  }
  function clearArea() {
    operationRef.current += 1
    setDrawing(false); setDraftPoints([]); setFeedback(""); onPolygonChange(null)
  }
  function undo() { setDraftPoints(draftRef.current.slice(0, -1)); setFeedback("") }
  function editBoundary(next) {
    const validation = validatePolygonGeometry(next, { allowIncomplete: drawing })
    if (!validation.valid) {
      setFeedback(validation.message)
      setEditVersion((version) => version + 1)
      return
    }
    setFeedback("")
    if (drawing) setDraftPoints(next)
    else onPolygonChange(closePolygon(next))
  }
  // Google retains event listeners for the map's lifetime; read current React state.
  useEffect(() => {
    handlersRef.current = {
      click(event) {
        if (!drawing || gpsLoading || disabled || !event.latLng) return
        event.stop?.()
        addPoint([Number(event.latLng.lng().toFixed(6)), Number(event.latLng.lat().toFixed(6))])
      },
      keydown(event) {
        if (drawing && !disabled && !gpsLoading && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z"
          && !event.shiftKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
          event.preventDefault(); undo()
        }
      },
    }
  })

  useEffect(() => {
    let active = true
    let map
    let clickListener
    const authError = () => setMapError("Google Maps is not authorized. Enable Maps JavaScript API and check this site's API key restrictions.")
    window.addEventListener("agrow-google-maps-auth-error", authError)
    loadGoogleMaps().then((maps) => {
      if (!active) return
      map = new maps.Map(containerRef.current, {
        center: SABAH_CENTER, zoom: 8, maxZoom: 19,
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
        mapTypeId: "hybrid", mapTypeControl: true, mapTypeControlOptions: { position: maps.ControlPosition.TOP_LEFT },
        streetViewControl: false, fullscreenControl: true, zoomControl: true,
        gestureHandling: "greedy", clickableIcons: false,
      })
      clickListener = map.addListener("click", (event) => handlersRef.current.click?.(event))
      setApi({ maps, map })
    }).catch((error) => { if (active) setMapError(error.message) })
    return () => {
      active = false; operationRef.current += 1
      clickListener?.remove()
      window.removeEventListener("agrow-google-maps-auth-error", authError)
      if (map) window.google.maps.event.clearInstanceListeners(map)
    }
  }, [])

  useEffect(() => { api?.map.setOptions({ disableDoubleClickZoom: drawing, draggableCursor: drawing ? "crosshair" : null }) }, [api, drawing])
  useEffect(() => {
    const handler = (event) => handlersRef.current.keydown?.(event)
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
  useEffect(() => {
    if (!api) return undefined
    const observer = new ResizeObserver(() => api.maps.event.trigger(api.map, "resize"))
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [api])
  useEffect(() => {
    if (!api || !isVisible || !fitBoundaryVersion || lastFitRef.current === fitBoundaryVersion || !polygon?.length) return
    const bounds = new api.maps.LatLngBounds()
    googlePath(polygon).forEach((point) => bounds.extend(point))
    api.map.fitBounds(bounds, 50)
    lastFitRef.current = fitBoundaryVersion
  }, [api, isVisible, fitBoundaryVersion, polygon])
  useEffect(() => {
    if (!api || !districtGeoJson) return undefined
    const layer = new api.maps.Data({ map: api.map })
    layer.addGeoJson(districtGeoJson)
    layer.setStyle({ clickable: false, strokeColor: "#809090", strokeWeight: 1, strokeOpacity: 0.6, fillOpacity: 0 })
    if (!initialFitRef.current && !lastFitRef.current) {
      const bounds = new api.maps.LatLngBounds()
      layer.forEach((feature) => feature.getGeometry()?.forEachLatLng((point) => bounds.extend(point)))
      if (!bounds.isEmpty()) api.map.fitBounds(bounds, 40)
      initialFitRef.current = true
    }
    return () => layer.setMap(null)
  }, [api, districtGeoJson])
  useEffect(() => {
    if (!api || !reservedForestGeoJson) return undefined
    const layer = new api.maps.Data({ map: api.map })
    layer.addGeoJson(reservedForestGeoJson)
    layer.setStyle({ clickable: false, strokeColor: "#5f6962", strokeWeight: 2, fillColor: "#79827b", fillOpacity: 0.32 })
    return () => layer.setMap(null)
  }, [api, reservedForestGeoJson])
  useEffect(() => {
    if (!api || !selectedPlace) return undefined
    const marker = new api.maps.marker.AdvancedMarkerElement({ map: api.map, position: selectedPlace.location, title: selectedPlace.name })
    if (selectedPlace.viewport) api.map.fitBounds(selectedPlace.viewport, 60)
    else { api.map.panTo(selectedPlace.location); api.map.setZoom(15) }
    return () => { marker.map = null }
  }, [api, selectedPlace])

  async function addGpsPoint() {
    if (!drawing) beginDrawing()
    const operation = ++operationRef.current
    setGpsLoading(true); setFeedback("")
    try {
      const coordinate = coordinateFromPosition(await requestCurrentPosition())
      if (operation !== operationRef.current) return
      const point = [coordinate.longitude, coordinate.latitude]
      if (!findDistrictForPoint(point, districtGeoJson?.features || [])) { setFeedback("Your current location is outside Sabah and was not added."); return }
      if (!addPoint(point)) return
      api.map.panTo({ lat: coordinate.latitude, lng: coordinate.longitude }); api.map.setZoom(Math.max(api.map.getZoom(), 15))
      setFeedback(accuracyWarning(coordinate.accuracy) || "Current location added to your boundary.")
    } catch (error) { if (operation === operationRef.current) setFeedback(geolocationErrorMessage(error)) }
    finally { if (operation === operationRef.current) setGpsLoading(false) }
  }

  return <section className="prediction-location-map" aria-label="Google Maps planting area">
    <GooglePlaceSearch maps={api?.maps} disabled={disabled} onSelect={(place) => setSelectedPlace(place ? { ...place } : null)} />
    <div className="google-planning-shell">
      <div ref={containerRef} className="google-planning-map" aria-label="Interactive Google map" />
      {api && showRegionShading && <GoogleSabahMask maps={api.maps} map={api.map} geoJson={sabahDisplayRegion} />}
      {!api && !mapError && <p className="google-map-loading" role="status">Loading Google Maps…</p>}
      {mapError && <div className="google-map-unavailable" role="alert"><strong>Google Maps could not load.</strong><p>{mapError}</p><button type="button" onClick={() => window.location.reload()}>Reload map</button></div>}
      {api && <GoogleBoundaryLayer maps={api.maps} map={api.map} points={points} drawing={drawing} blocked={isBlocked} disabled={disabled || gpsLoading} editVersion={editVersion} onEdit={editBoundary} onAddPoint={(event) => handlersRef.current.click?.(event)} />}
      <div className="google-boundary-summary" aria-live="polite">
        <strong>{formatHectares(calculatePolygonAreaHectares(points))}</strong>
        <span>{drawing ? `${draft.length} boundary point${draft.length === 1 ? "" : "s"}` : district || "No planting area selected"}</span>
        {isBlocked && <span className="google-boundary-blocked">Reserved forest · Planting blocked</span>}
      </div>
    </div>
    <div className="google-boundary-controls" role="group" aria-label="Boundary drawing controls">
      <button type="button" onClick={beginDrawing} disabled={disabled || gpsLoading}>{polygon?.length ? "Redraw Area" : "Start Boundary"}</button>
      <button type="button" onClick={finishDrawing} disabled={disabled || gpsLoading || !drawing || draft.length < 3}>Finish Boundary</button>
      <button type="button" onClick={undo} disabled={disabled || gpsLoading || !drawing || !draft.length}>Undo last point</button>
      <button type="button" onClick={addGpsPoint} disabled={disabled || gpsLoading}>{gpsLoading ? "Getting location…" : "Add Current Location Point"}</button>
      <button type="button" onClick={clearArea} disabled={disabled || gpsLoading || (!drawing && !polygon?.length)}>Clear Area</button>
    </div>
    <p className="google-map-help" role="status">{feedback || (drawing ? "Click the map to add points. Drag a point to adjust it, then choose Finish Boundary." : "Search for a location, then choose Start Boundary to draw directly on Google Maps.")}</p>
    <div className="google-map-guide">
      <label><input type="checkbox" checked={showRegionShading} onChange={(event) => setShowRegionShading(event.target.checked)} /> Shade outside Sabah</label>
      <p>The clear region includes Sabah's offshore islands and surrounding waters. Draw a planting boundary to check for reserved-forest overlap. Developed areas are not checked.</p>
      <p>Missing satellite tiles? Zoom out or switch to Map.</p>
      <small>Region boundary: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></small>
    </div>
  </section>
}
