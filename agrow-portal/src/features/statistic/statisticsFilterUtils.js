export const MAX_CROP_SELECTIONS = 4
export const MAX_DISTRICT_SELECTIONS = 10

export function createInitialStatisticsFilters() {
  return {
    cropNames: [],
    districts: [],
    timeMode: "all",
    year: "",
    startYear: "",
    endYear: "",
  }
}

export function buildStatisticsRequestFilters(filters) {
  return {
    cropNames: normalizeSelection(
      filters.cropNames,
      MAX_CROP_SELECTIONS,
    ),
    districts: normalizeSelection(
      filters.districts,
      MAX_DISTRICT_SELECTIONS,
    ),
    year: filters.timeMode === "year" ? filters.year : "",
    startYear: filters.timeMode === "range" ? filters.startYear : "",
    endYear: filters.timeMode === "range" ? filters.endYear : "",
  }
}

export function hasActiveStatisticsFilters(filters) {
  return Boolean(
    filters.cropNames.length ||
      filters.districts.length ||
      filters.timeMode !== "all",
  )
}

export function updateStatisticsFilter(
  currentFilters,
  name,
  value,
  options,
) {
  if (name === "cropNames") {
    return reconcileStatisticsSelections(
      {
        ...currentFilters,
        cropNames: normalizeSelection(value, MAX_CROP_SELECTIONS),
      },
      options,
    )
  }

  if (name === "districts") {
    const candidateDistricts = normalizeSelection(
      value,
      MAX_DISTRICT_SELECTIONS,
    )
    const availableDistricts = getAvailableDistrictSet(
      currentFilters.cropNames,
      options.districtsByCrop,
    )

    return {
      ...currentFilters,
      districts:
        availableDistricts === null
          ? candidateDistricts
          : candidateDistricts.filter((district) =>
              availableDistricts.has(district),
            ),
    }
  }

  if (name === "timeMode") {
    return switchTimeMode(currentFilters, value, options.years)
  }

  if (name === "startYear") {
    const endYear =
      currentFilters.endYear &&
      Number(value) > Number(currentFilters.endYear)
        ? value
        : currentFilters.endYear
    return { ...currentFilters, startYear: value, endYear }
  }

  if (name === "endYear") {
    const startYear =
      currentFilters.startYear &&
      Number(value) < Number(currentFilters.startYear)
        ? value
        : currentFilters.startYear
    return { ...currentFilters, startYear, endYear: value }
  }

  return { ...currentFilters, [name]: value }
}

export function reconcileStatisticsSelections(filters, options) {
  const cropNames = canonicalizeSelection(
    filters.cropNames,
    options.cropNames,
    MAX_CROP_SELECTIONS,
  )
  const districts = canonicalizeSelection(
    filters.districts,
    options.districts,
    MAX_DISTRICT_SELECTIONS,
  )
  const availableDistricts = getAvailableDistrictSet(
    cropNames,
    options.districtsByCrop,
  )
  const availableSelectedDistricts =
    availableDistricts === null
      ? districts
      : districts.filter((district) => availableDistricts.has(district))

  if (
    selectionsMatch(cropNames, filters.cropNames) &&
    selectionsMatch(availableSelectedDistricts, filters.districts)
  ) {
    return filters
  }

  return {
    ...filters,
    cropNames,
    districts: availableSelectedDistricts,
  }
}

export function getAvailableDistrictSet(cropNames, districtsByCrop) {
  const selectedCrops = normalizeSelection(
    cropNames,
    MAX_CROP_SELECTIONS,
  )
  if (!selectedCrops.length) return null

  const availableDistricts = new Set()
  for (const cropName of selectedCrops) {
    const cropDistricts = districtsByCrop?.[cropName]
    if (!Array.isArray(cropDistricts)) return null
    cropDistricts.forEach((district) => availableDistricts.add(district))
  }

  return availableDistricts
}

export function normalizeSelection(values, limit = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(values)) return []

  const seenValues = new Set()
  const normalizedValues = []

  for (const value of values) {
    if (typeof value !== "string") continue
    const normalizedValue = value.trim()
    const comparisonValue = normalizedValue.toLocaleLowerCase()
    if (!normalizedValue || seenValues.has(comparisonValue)) continue

    seenValues.add(comparisonValue)
    normalizedValues.push(normalizedValue)
    if (normalizedValues.length >= limit) break
  }

  return normalizedValues
}

export function getStatisticsFilterValidationError(filters) {
  if (filters.timeMode === "year" && !filters.year) {
    return "Select a year before applying the exact-year filter."
  }

  if (filters.timeMode !== "range") return ""
  if (!filters.startYear || !filters.endYear) {
    return "Select both a start year and an end year."
  }
  if (Number(filters.startYear) > Number(filters.endYear)) {
    return "Start year must be earlier than or equal to end year."
  }
  return ""
}

function canonicalizeSelection(values, availableValues, limit) {
  const normalizedValues = normalizeSelection(values, limit)
  if (!Array.isArray(availableValues) || !availableValues.length) {
    return normalizedValues
  }

  const canonicalValues = new Map(
    availableValues.map((value) => [value.toLocaleLowerCase(), value]),
  )
  return normalizedValues
    .map((value) => canonicalValues.get(value.toLocaleLowerCase()))
    .filter(Boolean)
}

function selectionsMatch(left, right) {
  return (
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function switchTimeMode(currentFilters, timeMode, years) {
  if (timeMode === "all") {
    return {
      ...currentFilters,
      timeMode,
      year: "",
      startYear: "",
      endYear: "",
    }
  }

  if (timeMode === "year") {
    const latestYear = years.at(-1)
    return {
      ...currentFilters,
      timeMode,
      year: currentFilters.year || String(latestYear ?? ""),
      startYear: "",
      endYear: "",
    }
  }

  const earliestYear = years.at(0)
  const latestYear = years.at(-1)
  return {
    ...currentFilters,
    timeMode: "range",
    year: "",
    startYear: currentFilters.startYear || String(earliestYear ?? ""),
    endYear: currentFilters.endYear || String(latestYear ?? ""),
  }
}
