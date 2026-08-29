import SearchableSelect from "./SearchableSelect"
import {
  getAvailableDistrictSet,
  MAX_CROP_SELECTIONS,
  MAX_DISTRICT_SELECTIONS,
} from "../statisticsFilterUtils"

export default function StatisticsFilters({
  filters,
  options,
  isLoadingOptions,
  validationError,
  hasActiveFilters,
  onChange,
  onReset,
}) {
  const hasYears = options.years.length > 0
  const selectedCropNames = Array.isArray(filters.cropNames)
    ? filters.cropNames
    : []
  const selectedDistricts = Array.isArray(filters.districts)
    ? filters.districts
    : []
  const availableDistricts = getAvailableDistrictSet(
    selectedCropNames,
    options.districtsByCrop,
  )
  const disabledDistricts = availableDistricts instanceof Set
    ? options.districts.filter(
        (district) => !availableDistricts.has(district),
      )
    : []
  const disabledDistrictReason =
    selectedCropNames.length === 1
      ? `No data for ${selectedCropNames[0]}`
      : "No data for any selected crop"
  const cropSupportMetadata = Array.isArray(options.crops)
    ? options.crops
    : []
  const hasCropSupportMetadata = cropSupportMetadata.some(
    (crop) => typeof crop?.mlSupported === "boolean",
  )
  const mlSupportedCount = cropSupportMetadata.filter(
    (crop) => crop?.mlSupported === true,
  ).length
  const statisticsOnlyCount = cropSupportMetadata.filter(
    (crop) => crop?.mlSupported === false,
  ).length
  const cropOptionStatuses = hasCropSupportMetadata
    ? Object.fromEntries(
        cropSupportMetadata.map((crop) => [
          crop.name,
          crop.mlSupported ? "ML prediction supported" : "Statistics only",
        ]),
      )
    : {}

  return (
    <section className="statistics-card statistics-filter-card" aria-labelledby="statistics-filter-title">
      <div className="statistics-filter-heading">
        <div>
          <h2 id="statistics-filter-title">Filter statistics</h2>
          <p>
            Every filter applies to the combined summary and all charts below.
            Districts without data for any selected crop are disabled.
          </p>
        </div>
        <button
          className="statistics-secondary-button"
          type="button"
          onClick={onReset}
          disabled={!hasActiveFilters}
        >
          Reset filters
        </button>
      </div>

      <div className="statistics-filter-grid">
        <SearchableSelect
          id="statistics-crop-filter"
          label="Crop"
          values={selectedCropNames}
          options={options.cropNames}
          allLabel="All crops"
          searchPlaceholder="Search crops..."
          clearLabel="Clear all crops"
          maxSelections={MAX_CROP_SELECTIONS}
          optionStatuses={cropOptionStatuses}
          onChange={(values) => onChange("cropNames", values)}
          disabled={isLoadingOptions}
        />

        <SearchableSelect
          id="statistics-district-filter"
          label="District"
          values={selectedDistricts}
          options={options.districts}
          allLabel="All districts"
          searchPlaceholder="Search districts..."
          clearLabel="Clear all districts"
          maxSelections={MAX_DISTRICT_SELECTIONS}
          disabledOptions={disabledDistricts}
          disabledOptionReason={disabledDistrictReason}
          onChange={(values) => onChange("districts", values)}
          disabled={isLoadingOptions}
        />

        <FilterSelect
          id="statistics-period-filter"
          label="Period"
          value={filters.timeMode}
          onChange={(value) => onChange("timeMode", value)}
          disabled={isLoadingOptions}
        >
          <option value="all">All years</option>
          <option value="year" disabled={!hasYears}>Specific year</option>
          <option value="range" disabled={!hasYears}>Custom range</option>
        </FilterSelect>

        {filters.timeMode === "year" && (
          <FilterSelect
            id="statistics-year-filter"
            label="Year"
            value={filters.year}
            onChange={(value) => onChange("year", value)}
            disabled={isLoadingOptions}
          >
            {options.years.map((year) => (
              <option value={year} key={year}>
                {year}
              </option>
            ))}
          </FilterSelect>
        )}

        {filters.timeMode === "range" && (
          <>
            <FilterSelect
              id="statistics-start-year-filter"
              label="Start year"
              value={filters.startYear}
              onChange={(value) => onChange("startYear", value)}
              disabled={isLoadingOptions}
            >
              {options.years.map((year) => (
                <option value={year} key={year}>
                  {year}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              id="statistics-end-year-filter"
              label="End year"
              value={filters.endYear}
              onChange={(value) => onChange("endYear", value)}
              disabled={isLoadingOptions}
            >
              {options.years.map((year) => (
                <option value={year} key={year}>
                  {year}
                </option>
              ))}
            </FilterSelect>
          </>
        )}
      </div>

      {hasCropSupportMetadata && (
        <p className="statistics-crop-support-summary" role="status">
          <strong>Prediction coverage:</strong> {mlSupportedCount} of{" "}
          {options.cropNames.length} crops support ML prediction;{" "}
          {statisticsOnlyCount} are statistics-only. All{" "}
          {options.cropNames.length} remain selectable for statistics.
        </p>
      )}

      {validationError && (
        <p className="statistics-filter-error" role="alert">
          {validationError}
        </p>
      )}
    </section>
  )
}

function FilterSelect({ id, label, value, onChange, disabled, children }) {
  return (
    <label className="statistics-filter-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {children}
      </select>
    </label>
  )
}
