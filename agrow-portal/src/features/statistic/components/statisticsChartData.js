const RELEVANT_AGGREGATE_FIELDS = [
  "planted_area_ha",
  "production_tonnes",
  "economic_value_myr",
]

export const CHART_SERIES_COLORS = [
  "#2f7d3c",
  "#2563eb",
  "#d97706",
  "#7c3aed",
  "#0f766e",
  "#0891b2",
  "#65a30d",
  "#c2410c",
  "#4f46e5",
  "#475569",
]

export function hasMeaningfulAggregate(item) {
  return RELEVANT_AGGREGATE_FIELDS.some((field) => {
    const value = toOptionalFiniteNumber(item?.[field])
    return value !== null && value !== 0
  })
}

export function buildYearlyTrendModel({
  data = [],
  cropYearlyTrends = [],
  districtYearlyTrends = [],
  selectedCrops = [],
  selectedDistricts = [],
} = {}) {
  const cropLabels = normalizeSelectedLabels(selectedCrops)
  const districtLabels = normalizeSelectedLabels(selectedDistricts)

  if (cropLabels.length > 1) {
    return buildGroupedYearlyModel({
      rows: cropYearlyTrends,
      field: "crop_name",
      kind: "crop",
      selectedLabels: cropLabels,
      context: districtLabels.length === 1 ? { district: districtLabels[0] } : {},
      description: "Production by crop for each year in the selected period.",
    })
  }

  if (cropLabels.length === 1 && districtLabels.length > 1) {
    return buildGroupedYearlyModel({
      rows: districtYearlyTrends,
      field: "district",
      kind: "district",
      selectedLabels: districtLabels,
      context: { crop_name: cropLabels[0] },
      description: "Production by district for each year in the selected period.",
    })
  }

  return buildAggregateYearlyModel(data, {
    crop_name: cropLabels.length === 1 ? cropLabels[0] : null,
    district: districtLabels.length === 1 ? districtLabels[0] : null,
  })
}

export function buildAggregateComparisonModel({
  data = [],
  categoryKey,
  limit = 10,
} = {}) {
  const meaningfulRows = data
    .filter((item) => cleanLabel(item?.[categoryKey]) && hasMeaningfulAggregate(item))
    .map((item) => ({
      ...item,
      chartCategory: cleanLabel(item[categoryKey]),
      ...normalizeMetrics(item),
      __detailsBySeries: {
        production_tonnes: {
          ...normalizeMetrics(item),
          [categoryKey]: cleanLabel(item[categoryKey]),
        },
      },
    }))
    .sort(compareAggregateRows)

  return {
    data: meaningfulRows.slice(0, limit),
    totalCategories: meaningfulRows.length,
  }
}

export function buildDistrictComparisonModel({
  data = [],
  selectedCrops = [],
  limit = 10,
} = {}) {
  const selectedLabels = normalizeSelectedLabels(selectedCrops)
  const canonicalByNormalizedLabel = new Map()

  data.forEach((item) => {
    const cropName = cleanLabel(item?.crop_name)
    if (cropName) canonicalByNormalizedLabel.set(normalizeLabel(cropName), cropName)
  })

  const allowedLabels = selectedLabels.length
    ? selectedLabels
        .map(
          (label) =>
            canonicalByNormalizedLabel.get(normalizeLabel(label)) || cleanLabel(label),
        )
        .filter(Boolean)
    : [...canonicalByNormalizedLabel.values()].sort(compareLabels)
  const allowedNormalizedLabels = new Set(allowedLabels.map(normalizeLabel))
  const districtRows = new Map()
  const populatedSeries = new Set()

  data.forEach((item) => {
    const district = cleanLabel(item?.district)
    const cropName = cleanLabel(item?.crop_name)
    if (!district || !cropName || !hasMeaningfulAggregate(item)) return
    if (
      allowedNormalizedLabels.size > 0 &&
      !allowedNormalizedLabels.has(normalizeLabel(cropName))
    ) {
      return
    }

    const canonicalCropName =
      canonicalByNormalizedLabel.get(normalizeLabel(cropName)) || cropName
    const seriesKey = createSeriesKey("crop", canonicalCropName)
    const districtKey = normalizeLabel(district)
    const row = districtRows.get(districtKey) || {
      chartCategory: district,
      __detailsBySeries: {},
      __totalProduction: 0,
    }
    const metrics = normalizeMetrics(item)

    if (metrics.production_tonnes !== null) {
      row[seriesKey] = metrics.production_tonnes
      row.__totalProduction += metrics.production_tonnes
    }
    row.__detailsBySeries[seriesKey] = {
      ...metrics,
      crop_name: canonicalCropName,
      district,
    }
    districtRows.set(districtKey, row)
    populatedSeries.add(normalizeLabel(canonicalCropName))
  })

  const series = allowedLabels
    .filter((label) => populatedSeries.has(normalizeLabel(label)))
    .map((label, index) => createSeries("crop", label, index))
  const rows = [...districtRows.values()].sort(
    (left, right) =>
      right.__totalProduction - left.__totalProduction ||
      compareLabels(left.chartCategory, right.chartCategory),
  )

  return {
    data: rows.slice(0, limit),
    series,
    totalCategories: rows.length,
  }
}

export function toOptionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function buildGroupedYearlyModel({
  rows,
  field,
  kind,
  selectedLabels,
  context,
  description,
}) {
  const canonicalByNormalizedLabel = new Map()
  rows.forEach((item) => {
    const label = cleanLabel(item?.[field])
    if (label) canonicalByNormalizedLabel.set(normalizeLabel(label), label)
  })

  const labels = selectedLabels
    .map(
      (label) =>
        canonicalByNormalizedLabel.get(normalizeLabel(label)) || cleanLabel(label),
    )
    .filter(Boolean)
  const selectedLabelSet = new Set(labels.map(normalizeLabel))
  const pointsByYear = new Map()
  const populatedSeries = new Set()

  rows.forEach((item) => {
    const year = toOptionalFiniteNumber(item?.year)
    const rawLabel = cleanLabel(item?.[field])
    if (year === null || !rawLabel) return

    const normalizedLabel = normalizeLabel(rawLabel)
    if (selectedLabelSet.size > 0 && !selectedLabelSet.has(normalizedLabel)) return

    const label = canonicalByNormalizedLabel.get(normalizedLabel) || rawLabel
    const seriesKey = createSeriesKey(kind, label)
    const metrics = normalizeMetrics(item)
    const point = pointsByYear.get(year) || { year, __detailsBySeries: {} }

    if (metrics.production_tonnes !== null) {
      point[seriesKey] = metrics.production_tonnes
      populatedSeries.add(normalizedLabel)
    }
    point.__detailsBySeries[seriesKey] = {
      ...metrics,
      ...context,
      [field]: label,
      year,
    }
    pointsByYear.set(year, point)
  })

  const series = labels
    .filter((label) => populatedSeries.has(normalizeLabel(label)))
    .map((label, index) => createSeries(kind, label, index))

  return {
    data: fillYearGaps([...pointsByYear.values()]),
    series,
    description,
  }
}

function buildAggregateYearlyModel(data, context) {
  const seriesKey = "production_tonnes"
  const rows = data
    .map((item) => {
      const year = toOptionalFiniteNumber(item?.year)
      const metrics = normalizeMetrics(item)
      if (year === null || metrics.production_tonnes === null) return null

      return {
        year,
        [seriesKey]: metrics.production_tonnes,
        __detailsBySeries: {
          [seriesKey]: { ...metrics, ...context, year },
        },
      }
    })
    .filter(Boolean)

  return {
    data: fillYearGaps(rows),
    series: rows.length > 0 ? [createSeries("aggregate", "Production", 0)] : [],
    description: "Production totals for each year in the selected period.",
  }
}

function normalizeMetrics(item) {
  const plantedArea = toOptionalFiniteNumber(item?.planted_area_ha)
  const production = toOptionalFiniteNumber(item?.production_tonnes)
  const economicValue = toOptionalFiniteNumber(item?.economic_value_myr)
  let yieldValue = toOptionalFiniteNumber(item?.yield_tonnes_per_ha)

  if (yieldValue === null && plantedArea !== null) {
    yieldValue =
      plantedArea > 0 && production !== null ? production / plantedArea : 0
  }

  return {
    planted_area_ha: plantedArea,
    production_tonnes: production,
    economic_value_myr: economicValue,
    yield_tonnes_per_ha: yieldValue,
  }
}

function fillYearGaps(rows) {
  if (rows.length < 2) return rows.sort((left, right) => left.year - right.year)

  const rowsByYear = new Map(rows.map((row) => [row.year, row]))
  const years = [...rowsByYear.keys()].sort((left, right) => left - right)
  const firstYear = years[0]
  const lastYear = years.at(-1)

  if (!Number.isInteger(firstYear) || !Number.isInteger(lastYear) || lastYear - firstYear > 200) {
    return rows.sort((left, right) => left.year - right.year)
  }

  const result = []
  for (let year = firstYear; year <= lastYear; year += 1) {
    result.push(rowsByYear.get(year) || { year, __detailsBySeries: {} })
  }
  return result
}

function createSeries(kind, label, index) {
  return {
    key: kind === "aggregate" ? "production_tonnes" : createSeriesKey(kind, label),
    label,
    color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
  }
}

function createSeriesKey(kind, label) {
  const normalizedLabel = normalizeLabel(label)
  const slug = normalizedLabel.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  let hash = 0

  for (let index = 0; index < normalizedLabel.length; index += 1) {
    hash = (hash * 31 + normalizedLabel.charCodeAt(index)) >>> 0
  }

  return `${kind}_${slug || "series"}_${hash.toString(36)}`
}

function normalizeSelectedLabels(values) {
  const labels = []
  const seen = new Set()

  values.forEach((value) => {
    const label = cleanLabel(
      typeof value === "string" ? value : value?.value ?? value?.label,
    )
    const normalizedLabel = normalizeLabel(label)
    if (!label || seen.has(normalizedLabel)) return

    seen.add(normalizedLabel)
    labels.push(label)
  })

  return labels
}

function cleanLabel(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeLabel(value) {
  return cleanLabel(value).toLocaleLowerCase("en-MY")
}

function compareAggregateRows(left, right) {
  const productionDifference =
    (right.production_tonnes ?? Number.NEGATIVE_INFINITY) -
    (left.production_tonnes ?? Number.NEGATIVE_INFINITY)
  return productionDifference || compareLabels(left.chartCategory, right.chartCategory)
}

function compareLabels(left, right) {
  return left.localeCompare(right, "en-MY", { sensitivity: "base" })
}
