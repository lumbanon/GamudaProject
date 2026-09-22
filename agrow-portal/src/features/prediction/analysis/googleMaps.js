export const SABAH_CENTER = { lat: 5.62, lng: 117.1 }
export const SABAH_BOUNDS = { south: 3.85, west: 114.95, north: 7.65, east: 119.65 }
export const SABAH_VIEW_BOUNDS = [[3.85, 114.95], [7.65, 119.65]]

let loadingPromise
export function loadGoogleMaps() {
  if (loadingPromise) return loadingPromise
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error("Google Maps has not been configured."))
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    let timeout
    function fail(message) { window.clearTimeout(timeout); reject(new Error(message)) }
    window.gm_authFailure = () => {
      window.dispatchEvent(new Event("agrow-google-maps-auth-error"))
      fail("Google Maps authorization failed. Check the API configuration.")
    }
    window.agrowGoogleMapsReady = () => { window.clearTimeout(timeout); resolve(window.google.maps) }
    const url = new URL("https://maps.googleapis.com/maps/api/js")
    for (const [name, value] of Object.entries({ key, v: "weekly", loading: "async", libraries: "marker,geocoding", callback: "agrowGoogleMapsReady", language: "en", region: "MY" })) url.searchParams.set(name, value)
    script.src = url.toString()
    script.async = true
    script.referrerPolicy = "strict-origin-when-cross-origin"
    script.onerror = () => fail("Google Maps could not load. Check your connection and reload the page.")
    timeout = window.setTimeout(() => fail("Google Maps took too long to load. Please reload the page."), 15000)
    document.head.append(script)
  })
  return loadingPromise
}

export function openBoundary(polygon) {
  const points = polygon || []
  return points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1] ? points.slice(0, -1) : points
}
export function googlePath(points) { return points.map(([lng, lat]) => ({ lat, lng })) }
export function coordinatesFromPath(path) {
  return path.getArray().map((point) => [Number(point.lng().toFixed(6)), Number(point.lat().toFixed(6))])
}
export function normalizeGoogleMapQuery(value) {
  return value.trim().replace(/\s+/g, " ").replace(/^kg\.?\s+/i, "Kampung ")
}
export function normalizeGooglePlaces(results) {
  return results.filter((result) => {
    const point = result.geometry?.location
    return point && point.lat() >= SABAH_BOUNDS.south && point.lat() <= SABAH_BOUNDS.north
      && point.lng() >= SABAH_BOUNDS.west && point.lng() <= SABAH_BOUNDS.east
  }).map((result) => ({ id: result.place_id, name: result.formatted_address, location: result.geometry.location, viewport: result.geometry.viewport }))
}
