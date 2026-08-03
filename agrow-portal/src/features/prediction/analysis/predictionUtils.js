export function calculatePolygonAreaHectares(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0

  const points = isClosedPolygon(polygon) ? polygon.slice(0, -1) : polygon
  if (points.length < 3) return 0

  const meanLat = points.reduce((sum, point) => sum + Number(point[1] || 0), 0) / points.length
  const metersPerDegreeLat = 110574
  const metersPerDegreeLon = 111320 * Math.cos((meanLat * Math.PI) / 180)

  const projected = points.map(([lon, lat]) => [
    Number(lon) * metersPerDegreeLon,
    Number(lat) * metersPerDegreeLat,
  ])

  const areaTwice = projected.reduce((sum, [x1, y1], index) => {
    const [x2, y2] = projected[(index + 1) % projected.length]
    return sum + x1 * y2 - x2 * y1
  }, 0)

  return Math.round((Math.abs(areaTwice) / 20000) * 100) / 100
}

export function formatHectares(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return "0 ha"
  return `${formatNumber(number, number >= 10 ? 1 : 2)} ha`
}

export function formatNumber(value, digits = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return "N/A"

  return number.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })
}

export function formatCurrency(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return "MYR 0"
  return `MYR ${number.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function getSuitabilityTone(status) {
  const normalized = String(status || "").toLowerCase()
  if (normalized.includes("high")) return "high"
  if (normalized.includes("low")) return "low"
  if (normalized.includes("moderate")) return "moderate"
  return "suitable"
}

export function buildFeatureRows(features = {}) {
  return [
    { label: "Rainfall", value: formatFeatureValue(features.rainfall_mm, "mm") },
    { label: "Solar radiation", value: formatFeatureValue(features.solar_radiation) },
    { label: "Root zone moisture", value: formatFeatureValue(features.root_zone_moisture) },
    { label: "Soil pH", value: formatFeatureValue(features.soil_ph) },
    { label: "Soil depth", value: formatFeatureValue(features.soil_depth_cm, "cm") },
    { label: "Elevation", value: formatFeatureValue(features.elevation_m, "m") },
    { label: "Slope", value: formatFeatureValue(features.slope_pct, "%") },
    { label: "Land cover", value: toTitleCase(features.land_cover || "N/A") },
  ]
}

export function buildClimateFeatureRows(features = {}) {
  return [
    { label: "Rainfall", value: formatFeatureValue(features.rainfall_mm, "mm") },
    { label: "Solar radiation", value: formatFeatureValue(features.solar_radiation) },
    { label: "Root zone moisture", value: formatFeatureValue(features.root_zone_moisture) },
  ]
}

export function buildSoilFeatureRows(features = {}) {
  return [
    { label: "Soil pH", value: formatFeatureValue(features.soil_ph) },
    { label: "Soil depth", value: formatFeatureValue(features.soil_depth_cm, "cm") },
  ]
}

export function buildTopoFeatureRows(features = {}) {
  return [
    { label: "Elevation", value: formatFeatureValue(features.elevation_m, "m") },
    { label: "Slope", value: formatFeatureValue(features.slope_pct, "%") },
    { label: "Land cover", value: toTitleCase(features.land_cover || "N/A") },
  ]
}

export function detectDistrictFromPolygon(polygon, districtFeatures = []) {
  const points = getOpenPolygonPoints(polygon)
  if (points.length < 3 || !Array.isArray(districtFeatures)) return ""

  const centroid = calculatePolygonCentroid(points)
  const candidatePoints = [centroid, ...points]

  for (const point of candidatePoints) {
    const match = districtFeatures.find((feature) => pointInFeature(point, feature))
    if (match) return getDistrictName(match)
  }

  return ""
}

export function findDistrictForPoint(point, districtFeatures = []) {
  if (!Array.isArray(point) || point.length < 2 || !Array.isArray(districtFeatures)) {
    return ""
  }

  const match = districtFeatures.find((feature) => pointInFeature(point, feature))
  return match ? getDistrictName(match) : ""
}

export function addPolygonPoint(points, point) {
  const normalizedPoints = normalizeOpenPolygon(points)
  const normalizedPoint = normalizeCoordinate(point)
  if (!normalizedPoint) {
    return { points: normalizedPoints, error: "The boundary point has invalid coordinates." }
  }

  const candidate = [...normalizedPoints, normalizedPoint]
  const validation = validatePolygonGeometry(candidate, { allowIncomplete: true })
  return validation.valid
    ? { points: candidate, error: "" }
    : { points: normalizedPoints, error: validation.message }
}

export function replacePolygonPoint(points, index, point) {
  const normalizedPoints = normalizeOpenPolygon(points)
  const normalizedPoint = normalizeCoordinate(point)
  if (!normalizedPoint || index < 0 || index >= normalizedPoints.length) {
    return { points: normalizedPoints, error: "The moved boundary point is invalid." }
  }

  const candidate = normalizedPoints.map((currentPoint, pointIndex) =>
    pointIndex === index ? normalizedPoint : currentPoint,
  )
  const validation = validatePolygonGeometry(candidate, { allowIncomplete: true })
  return validation.valid
    ? { points: candidate, error: "" }
    : { points: normalizedPoints, error: validation.message }
}

export function validatePolygonGeometry(polygon, { allowIncomplete = false } = {}) {
  const points = normalizeOpenPolygon(polygon)
  if (points.length !== getOpenPolygonPoints(polygon).length) {
    return {
      valid: false,
      code: "invalid_coordinate",
      message: "Boundary coordinates must be valid longitude and latitude values.",
    }
  }

  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length
    if (points.length > 1 && coordinatesEqual(points[index], points[nextIndex])) {
      return {
        valid: false,
        code: "duplicate_point",
        message: "Boundary points must not overlap.",
      }
    }
  }

  if (points.length < 3) {
    return allowIncomplete
      ? { valid: true, code: "incomplete", message: "Add at least three boundary points." }
      : { valid: false, code: "incomplete", message: "Add at least three boundary points." }
  }

  if (polygonHasSelfIntersection(points)) {
    return {
      valid: false,
      code: "self_intersection",
      message: "That point would make the boundary cross itself.",
    }
  }

  if (calculatePolygonAreaHectares(points) <= 0) {
    return {
      valid: false,
      code: "zero_area",
      message: "Boundary points must enclose a measurable area.",
    }
  }

  return { valid: true, code: "valid", message: "" }
}

export function closePolygon(points) {
  const openPoints = normalizeOpenPolygon(points)
  if (openPoints.length < 3) return []
  return [...openPoints, [...openPoints[0]]]
}

export function polygonHasSelfIntersection(polygon) {
  const points = normalizeOpenPolygon(polygon)
  if (points.length < 4) return false

  const edges = points.map((point, index) => [
    point,
    points[(index + 1) % points.length],
  ])

  for (let first = 0; first < edges.length; first += 1) {
    for (let second = first + 1; second < edges.length; second += 1) {
      if (edgesAreAdjacent(first, second, edges.length)) continue
      if (segmentsIntersect(edges[first], edges[second])) return true
    }
  }

  return false
}

export function formatPlaceholderFields(fields = []) {
  if (!Array.isArray(fields) || fields.length === 0) return ""
  return fields.map((field) => toTitleCase(String(field).replaceAll("_", " "))).join(", ")
}

const DEFAULT_FARMER_DATA_MESSAGE = "Based on available crop and environmental data."
const RETURN_BASIS_MESSAGE =
  "The return estimate is based on historical crop production data, estimated yield, market value, and the suitability score for this location."

export function formatFarmerDataSourceLabel(value) {
  const text = normalizeFarmerText(value).toLowerCase()
  if (!text) return "Available data"
  if (hasTechnicalSourceTerm(text)) return "Local data"
  if (text.includes("placeholder") || text.includes("fallback")) return "Available data"
  return "Available data"
}

export function formatFarmerDataSource(value) {
  const text = normalizeFarmerText(value)
  if (!text || text.toLowerCase() === "n/a") return DEFAULT_FARMER_DATA_MESSAGE

  const normalized = text.toLowerCase()
  if (normalized.includes("crop_statistics")) {
    return "Estimated using local crop statistics and the suitability score."
  }
  if (hasTechnicalSourceTerm(normalized)) {
    return "Based on local crop, soil, climate, and terrain data."
  }

  return DEFAULT_FARMER_DATA_MESSAGE
}

export function formatFarmerReturnConfidence(value) {
  const text = normalizeFarmerText(value)
  if (!text || text.toLowerCase() === "n/a") return DEFAULT_FARMER_DATA_MESSAGE

  const normalized = text.toLowerCase()
  if (normalized.includes("unavailable until") || normalized.includes("field boundary")) {
    return "Return estimate is unavailable until a field boundary is provided."
  }
  if (normalized.includes("no usable production") || normalized.includes("not enough local crop")) {
    return "Return estimate is unavailable because there is not enough local crop production and value data for this crop."
  }
  if (normalized.includes("crop_statistics") || normalized.includes("calculated from")) {
    return "Medium confidence estimate based on available crop statistics and the calculated suitability score."
  }
  if (normalized.includes("reference") || normalized.includes("assumption")) {
    return "Low confidence estimate based on general crop assumptions because local crop statistics are limited."
  }
  if (hasTechnicalSourceTerm(normalized)) {
    return DEFAULT_FARMER_DATA_MESSAGE
  }

  return formatFarmerFacingText(text)
}

export function formatFarmerReturnBasis(value) {
  const text = normalizeFarmerText(value)
  if (!text || text.toLowerCase() === "n/a") return DEFAULT_FARMER_DATA_MESSAGE

  const normalized = text.toLowerCase()
  if (normalized.includes("no area supplied") || normalized.includes("field boundary")) {
    return "The return estimate needs a selected farm area before yield and revenue can be calculated."
  }
  if (normalized.includes("crop_statistics") || normalized.includes("production data") || normalized.includes("market value")) {
    return RETURN_BASIS_MESSAGE
  }
  if (normalized.includes("reference") || normalized.includes("assumption")) {
    return "The return estimate is based on general crop assumptions and the suitability score for this location."
  }
  if (hasTechnicalSourceTerm(normalized)) {
    return DEFAULT_FARMER_DATA_MESSAGE
  }

  return formatFarmerFacingText(text)
}

export function formatFarmerFacingText(value) {
  const text = normalizeFarmerText(value)
  if (!text) return ""

  return text
    .replace(/PostgreSQL\/PostGIS/gi, "local map data")
    .replace(/PostGIS/gi, "map data")
    .replace(/PostgreSQL/gi, "local data")
    .replace(/crop_statistics/gi, "crop statistics")
    .replace(/spatial_grids/gi, "environmental grid data")
    .replace(/agrow_db/gi, "Agrow local data")
    .replace(/raster/gi, "map layer")
    .replace(/\s+/g, " ")
    .trim()
}

function formatFeatureValue(value, unit = "") {
  const number = Number(value)
  if (!Number.isFinite(number)) return "N/A"
  return unit ? `${formatNumber(number, number % 1 === 0 ? 0 : 2)} ${unit}` : formatNumber(number, 2)
}

function normalizeFarmerText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim()
}

function hasTechnicalSourceTerm(text) {
  return /postgresql|postgis|crop_statistics|spatial_grids|agrow_db|raster/.test(text)
}

function isClosedPolygon(polygon) {
  // Three unique vertices plus a repeated starting vertex are required for a
  // closed polygon. A one-point draft otherwise looks closed and is discarded
  // when the user adds the next boundary point.
  if (!Array.isArray(polygon) || polygon.length < 4) return false

  const first = polygon[0]
  const last = polygon[polygon.length - 1]
  return Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1]
}

function getOpenPolygonPoints(polygon) {
  if (!Array.isArray(polygon)) return []
  return isClosedPolygon(polygon) ? polygon.slice(0, -1) : polygon
}

function normalizeOpenPolygon(polygon) {
  return getOpenPolygonPoints(polygon)
    .map(normalizeCoordinate)
    .filter(Boolean)
}

function normalizeCoordinate(point) {
  if (!Array.isArray(point) || point.length < 2) return null
  const longitude = Number(point[0])
  const latitude = Number(point[1])
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null
  }
  return [longitude, latitude]
}

function segmentsIntersect([firstStart, firstEnd], [secondStart, secondEnd]) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart)
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd)
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart)
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd)

  if (
    firstOrientation !== secondOrientation &&
    thirdOrientation !== fourthOrientation
  ) {
    return true
  }

  if (firstOrientation === 0 && pointOnSegment(firstStart, secondStart, firstEnd)) return true
  if (secondOrientation === 0 && pointOnSegment(firstStart, secondEnd, firstEnd)) return true
  if (thirdOrientation === 0 && pointOnSegment(secondStart, firstStart, secondEnd)) return true
  return fourthOrientation === 0 && pointOnSegment(secondStart, firstEnd, secondEnd)
}

function orientation(first, second, third) {
  const value =
    (second[1] - first[1]) * (third[0] - second[0]) -
    (second[0] - first[0]) * (third[1] - second[1])
  if (Math.abs(value) < 1e-12) return 0
  return value > 0 ? 1 : 2
}

function pointOnSegment(first, point, second) {
  return (
    point[0] <= Math.max(first[0], second[0]) + 1e-12 &&
    point[0] >= Math.min(first[0], second[0]) - 1e-12 &&
    point[1] <= Math.max(first[1], second[1]) + 1e-12 &&
    point[1] >= Math.min(first[1], second[1]) - 1e-12
  )
}

function edgesAreAdjacent(first, second, edgeCount) {
  return (
    first === second ||
    Math.abs(first - second) === 1 ||
    (first === 0 && second === edgeCount - 1)
  )
}

function coordinatesEqual(first, second) {
  return Math.abs(first[0] - second[0]) < 1e-12 && Math.abs(first[1] - second[1]) < 1e-12
}

function calculatePolygonCentroid(points) {
  const totals = points.reduce(
    (sum, [lon, lat]) => [sum[0] + Number(lon || 0), sum[1] + Number(lat || 0)],
    [0, 0],
  )

  return [totals[0] / points.length, totals[1] / points.length]
}

function pointInFeature(point, feature) {
  const geometry = feature?.geometry
  if (!geometry) return false

  if (geometry.type === "Polygon") {
    return pointInPolygonCoordinates(point, geometry.coordinates)
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygonCoordinates) => pointInPolygonCoordinates(point, polygonCoordinates))
  }

  return false
}

function pointInPolygonCoordinates(point, polygonCoordinates) {
  const [outerRing, ...holes] = polygonCoordinates || []
  if (!outerRing || !pointInRing(point, outerRing)) return false

  return !holes.some((ring) => pointInRing(point, ring))
}

function pointInRing([lon, lat], ring) {
  let inside = false

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLon, currentLat] = ring[current]
    const [previousLon, previousLat] = ring[previous]
    const crossesLatitude = currentLat > lat !== previousLat > lat
    const intersectionLon = ((previousLon - currentLon) * (lat - currentLat)) / (previousLat - currentLat) + currentLon

    if (crossesLatitude && lon < intersectionLon) inside = !inside
  }

  return inside
}

function getDistrictName(feature) {
  return (
    feature?.properties?.district ||
    feature?.properties?.district_name ||
    feature?.properties?.shapeName ||
    feature?.properties?.name ||
    ""
  )
}

function toTitleCase(value) {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
