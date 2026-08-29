import { useCallback, useEffect, useMemo, useState } from "react"
import {
  APP_PREFERENCE_KEYS,
  useAppPreference,
} from "../../context/appPreferences"
import StatisticsFilters from "./components/StatisticsFilters"
import {
  ComparisonBarChart,
  YieldTrendChart,
} from "./components/StatisticsCharts"
import { hasMeaningfulAggregate } from "./components/statisticsChartData"
import {
  fetchCropStatistics,
  fetchStatisticOptions,
} from "./statisticsApi"
import {
  buildStatisticsRequestFilters,
  createInitialStatisticsFilters,
  getStatisticsFilterValidationError,
  hasActiveStatisticsFilters,
  reconcileStatisticsSelections,
  updateStatisticsFilter,
} from "./statisticsFilterUtils"
import {
  formatArea,
  formatCurrency,
  formatInteger,
  formatProduction,
  formatYield,
  toFiniteNumber,
} from "./statisticsFormatters"
import "./statistic-view.css"

const EMPTY_OPTIONS = {
  cropNames: [],
  crops: [],
  districts: [],
  years: [],
  districtsByCrop: {},
}

const SUMMARY_CARDS = [
  {
    key: "total_planted_area_ha",
    label: "Total Planted Area",
    detail: "Combined area across the current selection",
    formatter: formatArea,
  },
  {
    key: "total_production_tonnes",
    label: "Total Production",
    detail: "Combined production across the current selection",
    formatter: formatProduction,
  },
  {
    key: "total_economic_value_myr",
    label: "Total Economic Value",
    detail: "Combined value across the current selection",
    formatter: formatCurrency,
  },
  {
    key: "average_yield_tonnes_per_ha",
    label: "Average Yield",
    detail: "Combined production divided by combined planted area",
    formatter: formatYield,
  },
]

export default function StatisticViews() {
  const [filters, setFilters] = useAppPreference(
    APP_PREFERENCE_KEYS.statisticsFilters,
    createInitialStatisticsFilters,
  )
  const [options, setOptions] = useState(EMPTY_OPTIONS)
  const [statistics, setStatistics] = useState(null)
  const [isLoadingOptions, setIsLoadingOptions] = useState(true)
  const [isLoadingStatistics, setIsLoadingStatistics] = useState(true)
  const [optionsError, setOptionsError] = useState("")
  const [statisticsError, setStatisticsError] = useState("")
  const [optionsRetryKey, setOptionsRetryKey] = useState(0)
  const [statisticsRetryKey, setStatisticsRetryKey] = useState(0)

  const validationError = getStatisticsFilterValidationError(filters)
  const requestFilters = useMemo(
    () => buildStatisticsRequestFilters(filters),
    [filters],
  )
  const hasActiveFilters = hasActiveStatisticsFilters(filters)

  useEffect(() => {
    const controller = new AbortController()
    let isCurrentRequest = true

    async function loadOptions() {
      setIsLoadingOptions(true)
      setOptionsError("")

      try {
        const nextOptions = await fetchStatisticOptions({
          signal: controller.signal,
        })
        if (isCurrentRequest) {
          setOptions(nextOptions)
          setFilters((currentFilters) =>
            reconcileStatisticsSelections(currentFilters, nextOptions),
          )
        }
      } catch (requestError) {
        if (requestError?.name !== "AbortError" && isCurrentRequest) {
          setOptionsError(requestError.message)
        }
      } finally {
        if (isCurrentRequest) setIsLoadingOptions(false)
      }
    }

    loadOptions()

    return () => {
      isCurrentRequest = false
      controller.abort()
    }
  }, [optionsRetryKey, setFilters])

  useEffect(() => {
    if (validationError) return undefined

    const controller = new AbortController()
    let isCurrentRequest = true

    async function loadStatistics() {
      setIsLoadingStatistics(true)
      setStatisticsError("")
      setStatistics(null)

      try {
        const payload = await fetchCropStatistics(requestFilters, {
          signal: controller.signal,
        })
        if (isCurrentRequest) setStatistics(payload)
      } catch (requestError) {
        if (requestError?.name !== "AbortError" && isCurrentRequest) {
          setStatisticsError(requestError.message)
        }
      } finally {
        if (isCurrentRequest) setIsLoadingStatistics(false)
      }
    }

    loadStatistics()

    return () => {
      isCurrentRequest = false
      controller.abort()
    }
  }, [requestFilters, statisticsRetryKey, validationError])

  const handleFilterChange = useCallback(
    (name, value) => {
      setFilters((currentFilters) =>
        updateStatisticsFilter(currentFilters, name, value, options),
      )
    },
    [options, setFilters],
  )

  const resetFilters = useCallback(() => {
    setFilters(createInitialStatisticsFilters())
  }, [setFilters])

  const recordCount = toFiniteNumber(statistics?.record_count)
  const hasMeaningfulSummary = hasMeaningfulAggregate({
    planted_area_ha: statistics?.summary?.total_planted_area_ha,
    production_tonnes: statistics?.summary?.total_production_tonnes,
    economic_value_myr: statistics?.summary?.total_economic_value_myr,
  })
  const isEmpty =
    Boolean(statistics) && (recordCount === 0 || !hasMeaningfulSummary)
  const yearlyTrends = asArray(statistics?.yearly_trends)
  const cropYearlyTrends = asArray(statistics?.crop_yearly_trends)
  const districtYearlyTrends = asArray(statistics?.district_yearly_trends)
  const cropComparison = asArray(statistics?.crop_comparison)
  const districtComparison = asArray(statistics?.district_comparison)
  const cropDistrictComparison = asArray(
    statistics?.crop_district_comparison,
  )

  return (
    <div className="statistics-page" aria-busy={isLoadingStatistics}>
      <header className="statistics-hero">
        <div>
          <span className="statistics-eyebrow">Crop statistics</span>
          <h1>Sabah Agricultural Production Dashboard</h1>
          <p>
            Explore planted area, production, economic value, and yield from
            recorded agricultural statistics.
          </p>
        </div>
        {statistics && !isLoadingStatistics && !isEmpty && (
          <span className="statistics-record-badge">
            {formatInteger(recordCount)} {recordCount === 1 ? "record" : "records"}
          </span>
        )}
      </header>

      <StatisticsFilters
        filters={filters}
        options={options}
        isLoadingOptions={isLoadingOptions}
        validationError={validationError}
        hasActiveFilters={hasActiveFilters}
        onChange={handleFilterChange}
        onReset={resetFilters}
      />

      {optionsError && (
        <section className="statistics-options-error" role="alert">
          <div>
            <strong>Filter options could not be loaded.</strong>
            <span>{optionsError}</span>
          </div>
          <button
            className="statistics-secondary-button"
            type="button"
            onClick={() => setOptionsRetryKey((key) => key + 1)}
          >
            Retry options
          </button>
        </section>
      )}

      <div className="statistics-sr-only" aria-live="polite">
        {getLiveStatus({
          isLoadingStatistics,
          statisticsError,
          recordCount,
          hasStatistics: Boolean(statistics),
          isEmpty,
        })}
      </div>

      {isLoadingStatistics && (
        <StatisticsState
          variant="loading"
          title="Loading crop statistics"
          message="Updating the summary and charts with database records."
        />
      )}

      {!isLoadingStatistics && statisticsError && (
        <StatisticsState
          variant="error"
          title="Crop statistics could not be loaded"
          message={statisticsError}
          actionLabel="Try again"
          onAction={() => setStatisticsRetryKey((key) => key + 1)}
        />
      )}

      {!isLoadingStatistics && !statisticsError && isEmpty && (
        <StatisticsState
          variant="empty"
          title="No statistics found"
          message="No statistics are available for the selected crops, districts, and year range."
          actionLabel={hasActiveFilters ? "Clear filters" : "Reload data"}
          onAction={
            hasActiveFilters
              ? resetFilters
              : () => setStatisticsRetryKey((key) => key + 1)
          }
        />
      )}

      {!isLoadingStatistics && !statisticsError && statistics && !isEmpty && (
        <>
          <KPISection summary={statistics.summary} />

          <section className="statistics-chart-grid" aria-label="Crop statistics charts">
            <YieldTrendChart
              data={yearlyTrends}
              cropYearlyTrends={cropYearlyTrends}
              districtYearlyTrends={districtYearlyTrends}
              selectedCrops={filters.cropNames}
              selectedDistricts={filters.districts}
            />
            <ComparisonBarChart
              title="Crop Production Comparison"
              description="Production totals by crop for the selected filters."
              data={cropComparison}
              categoryKey="crop_name"
              categoryLabel="Crop"
            />
            <ComparisonBarChart
              title="District Production Comparison"
              description="Production totals by district for the selected filters."
              data={districtComparison}
              categoryKey="district"
              categoryLabel="District"
              groupedData={cropDistrictComparison}
              selectedCrops={filters.cropNames}
            />
          </section>
        </>
      )}
    </div>
  )
}

function KPISection({ summary = {} }) {
  return (
    <section className="statistics-summary-grid" aria-label="Statistics summary">
      {SUMMARY_CARDS.map((card) => (
        <article className="statistics-summary-card" key={card.key}>
          <span className="statistics-summary-label">{card.label}</span>
          <strong className="statistics-summary-value">
            {card.formatter(summary?.[card.key])}
          </strong>
          <p>{card.detail}</p>
        </article>
      ))}
    </section>
  )
}

function StatisticsState({
  variant,
  title,
  message,
  actionLabel,
  onAction,
}) {
  const isLoading = variant === "loading"

  return (
    <section
      className={`statistics-state statistics-state--${variant}`}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      {isLoading && <span className="statistics-spinner" aria-hidden="true" />}
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      {actionLabel && onAction && (
        <button className="statistics-primary-button" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </section>
  )
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function getLiveStatus({
  isLoadingStatistics,
  statisticsError,
  recordCount,
  hasStatistics,
  isEmpty,
}) {
  if (isLoadingStatistics) return "Loading crop statistics."
  if (statisticsError) return `Unable to load crop statistics. ${statisticsError}`
  if (isEmpty) return "No crop statistics match the selected filters."
  if (hasStatistics) return `${formatInteger(recordCount)} crop statistic records loaded.`
  return ""
}
