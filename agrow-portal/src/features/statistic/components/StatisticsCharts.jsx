import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  formatArea,
  formatCompactNumber,
  formatCurrency,
  formatProduction,
  formatYield,
} from "../statisticsFormatters"
import {
  buildAggregateComparisonModel,
  buildDistrictComparisonModel,
  buildYearlyTrendModel,
} from "./statisticsChartData"

const MAX_VISIBLE_CATEGORIES = 10
const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #dce8df",
  borderRadius: "10px",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.08)",
  color: "#1e293b",
  fontSize: "12px",
  maxHeight: "320px",
  minWidth: "220px",
  overflowY: "auto",
  padding: "10px 12px",
}

export function YieldTrendChart({
  data = [],
  cropYearlyTrends = [],
  districtYearlyTrends = [],
  selectedCrops = [],
  selectedDistricts = [],
}) {
  const chartModel = useMemo(
    () =>
      buildYearlyTrendModel({
        data,
        cropYearlyTrends,
        districtYearlyTrends,
        selectedCrops,
        selectedDistricts,
      }),
    [
      cropYearlyTrends,
      data,
      districtYearlyTrends,
      selectedCrops,
      selectedDistricts,
    ],
  )
  const hasChartData = chartModel.data.length > 0 && chartModel.series.length > 0

  return (
    <article className="statistics-card statistics-chart-card statistics-chart-card--wide">
      <div className="statistics-card-heading">
        <h2>Yearly Production Trend</h2>
        <p>{chartModel.description}</p>
      </div>

      {hasChartData ? (
        <>
          <ChartSeriesLegend series={chartModel.series} />
          <div className="statistics-chart-canvas statistics-chart-canvas--trend">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                accessibilityLayer
                data={chartModel.data}
                margin={{ top: 8, right: 18, left: 28, bottom: 8 }}
              >
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="year"
                  height={50}
                  tick={{ fill: "#617268", fontSize: 12, fontWeight: 550 }}
                  tickLine={false}
                  axisLine={{ stroke: "#cbd5e1" }}
                  label={{
                    value: "Year",
                    position: "insideBottom",
                    offset: -10,
                    fill: "#617268",
                    fontWeight: 550,
                  }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "#617268", fontSize: 12, fontWeight: 550 }}
                  tickFormatter={formatCompactNumber}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  label={{
                    value: "Production (tonnes)",
                    angle: -90,
                    position: "insideLeft",
                    offset: -18,
                    fill: "#617268",
                    fontWeight: 550,
                  }}
                />
                <Tooltip content={<MetricsTooltip labelType="Year" />} filterNull />
                {chartModel.series.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={3}
                    dot={{ r: 4, fill: series.color, strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="statistics-chart-empty">
          No yearly production data is available for these filters.
        </div>
      )}
    </article>
  )
}

export function ComparisonBarChart({
  title,
  description,
  data = [],
  categoryKey,
  categoryLabel,
  groupedData,
  selectedCrops = [],
}) {
  const useGroupedDistrictChart =
    categoryKey === "district" &&
    Array.isArray(groupedData) &&
    countSelectedValues(selectedCrops) > 0
  const aggregateModel = useMemo(
    () =>
      buildAggregateComparisonModel({
        data,
        categoryKey,
        limit: MAX_VISIBLE_CATEGORIES,
      }),
    [categoryKey, data],
  )
  const groupedModel = useMemo(
    () =>
      buildDistrictComparisonModel({
        data: groupedData || [],
        selectedCrops,
        limit: MAX_VISIBLE_CATEGORIES,
      }),
    [groupedData, selectedCrops],
  )
  const chartModel = useGroupedDistrictChart ? groupedModel : aggregateModel
  const isTruncated = chartModel.totalCategories > chartModel.data.length

  return (
    <article className="statistics-card statistics-chart-card">
      <div className="statistics-card-heading">
        <h2>{title}</h2>
        <p>{description}</p>
        {chartModel.data.length > 0 && (
          <span className="statistics-chart-count">
            {isTruncated
              ? `Showing the top ${chartModel.data.length} of ${chartModel.totalCategories} by production.`
              : `Showing all ${chartModel.data.length} ${categoryLabel.toLowerCase()} entries.`}
          </span>
        )}
      </div>

      {chartModel.data.length > 0 ? (
        useGroupedDistrictChart ? (
          <GroupedDistrictChart chartModel={chartModel} />
        ) : (
          <AggregateBarChart
            chartModel={chartModel}
            categoryLabel={categoryLabel}
          />
        )
      ) : (
        <div className="statistics-chart-empty">
          No comparison data is available for these filters.
        </div>
      )}
    </article>
  )
}

function AggregateBarChart({ chartModel, categoryLabel }) {
  const chartHeight = Math.max(320, chartModel.data.length * 42 + 78)

  return (
    <div className="statistics-chart-canvas" style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer
          data={chartModel.data}
          layout="vertical"
          margin={{ top: 4, right: 20, left: 28, bottom: 28 }}
        >
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "#617268", fontSize: 12, fontWeight: 550 }}
            tickFormatter={formatCompactNumber}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
            label={{
              value: "Production (tonnes)",
              position: "insideBottom",
              offset: -18,
              fill: "#617268",
              fontWeight: 550,
            }}
          />
          <YAxis
            type="category"
            dataKey="chartCategory"
            tick={{ fill: "#1e293b", fontSize: 12, fontWeight: 550 }}
            tickFormatter={truncateCategory}
            tickLine={false}
            axisLine={false}
            width={112}
            label={{
              value: categoryLabel,
              angle: -90,
              position: "insideLeft",
              offset: -18,
              fill: "#617268",
              fontWeight: 550,
            }}
          />
          <Tooltip
            content={<MetricsTooltip labelType={categoryLabel} />}
            cursor={{ fill: "#f4f8f5" }}
            filterNull
          />
          <Bar
            dataKey="production_tonnes"
            name="Production"
            fill="#2f7d3c"
            radius={[0, 5, 5, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function GroupedDistrictChart({ chartModel }) {
  const rowHeight = Math.max(48, chartModel.series.length * 18 + 24)
  const chartHeight = Math.max(320, chartModel.data.length * rowHeight + 96)

  return (
    <>
      <ChartSeriesLegend series={chartModel.series} marker="square" />
      <div
        className="statistics-chart-canvas"
        style={{ height: chartHeight }}
        aria-label="Grouped district production chart"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={chartModel.data}
            layout="vertical"
            margin={{ top: 8, right: 20, left: 28, bottom: 28 }}
          >
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fill: "#617268", fontSize: 12, fontWeight: 550 }}
              tickFormatter={formatCompactNumber}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              label={{
                value: "Production (tonnes)",
                position: "insideBottom",
                offset: -18,
                fill: "#617268",
                fontWeight: 550,
              }}
            />
            <YAxis
              type="category"
              dataKey="chartCategory"
              interval={0}
              tick={{ fill: "#1e293b", fontSize: 12, fontWeight: 550 }}
              tickFormatter={truncateCategory}
              tickLine={false}
              axisLine={false}
              width={116}
              label={{
                value: "District",
                angle: -90,
                position: "insideLeft",
                offset: -20,
                fill: "#617268",
                fontWeight: 550,
              }}
            />
            <Tooltip
              content={<MetricsTooltip labelType="District" />}
              cursor={{ fill: "#f4f8f5" }}
              filterNull
            />
            {chartModel.series.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                fill={series.color}
                radius={[0, 5, 5, 0]}
                maxBarSize={18}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function MetricsTooltip({ active, payload = [], label, labelType }) {
  if (!active || payload.length === 0) return null

  const entries = payload.filter((entry, index, values) => {
    const details = entry?.payload?.__detailsBySeries?.[entry.dataKey]
    return details && values.findIndex((item) => item.dataKey === entry.dataKey) === index
  })
  if (entries.length === 0) return null

  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ color: "#163f25", fontWeight: 650, marginBottom: "8px" }}>
        {labelType}: {label}
      </div>
      {entries.map((entry, index) => {
        const details = entry.payload.__detailsBySeries[entry.dataKey]

        return (
          <div
            key={entry.dataKey}
            style={{
              borderTop: index === 0 ? "none" : "1px solid #edf2ef",
              marginTop: index === 0 ? 0 : "8px",
              paddingTop: index === 0 ? 0 : "8px",
            }}
          >
            <div style={{ color: entry.color || "#2f7d3c", fontWeight: 650 }}>
              {entry.name}
            </div>
            {details.crop_name && <TooltipRow label="Crop" value={details.crop_name} />}
            {details.district && <TooltipRow label="District" value={details.district} />}
            <TooltipRow
              label="Planted area"
              value={formatOptionalMetric(details.planted_area_ha, formatArea)}
            />
            <TooltipRow
              label="Production"
              value={formatOptionalMetric(details.production_tonnes, formatProduction)}
            />
            <TooltipRow
              label="Economic value"
              value={formatOptionalMetric(details.economic_value_myr, formatCurrency)}
            />
            <TooltipRow
              label="Yield"
              value={formatOptionalMetric(details.yield_tonnes_per_ha, formatYield)}
            />
          </div>
        )
      })}
    </div>
  )
}

function TooltipRow({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        justifyContent: "space-between",
        lineHeight: 1.5,
      }}
    >
      <span style={{ color: "#617268" }}>{label}</span>
      <span style={{ color: "#1e293b", fontWeight: 550, textAlign: "right" }}>
        {value}
      </span>
    </div>
  )
}

function ChartSeriesLegend({ series = [], marker = "circle" }) {
  if (series.length < 2) return null

  return (
    <ul className="statistics-chart-legend" aria-label="Chart series">
      {series.map((item) => (
        <li className="statistics-chart-legend-item" key={item.key}>
          <span
            className={`statistics-chart-legend-marker statistics-chart-legend-marker--${marker}`}
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

function formatOptionalMetric(value, formatter) {
  return Number.isFinite(value) ? formatter(value) : "Not available"
}

function countSelectedValues(values) {
  return new Set(
    values
      .map((value) =>
        typeof value === "string" ? value.trim() : value?.value ?? value?.label,
      )
      .filter(Boolean)
      .map((value) => value.toLocaleLowerCase("en-MY")),
  ).size
}

function truncateCategory(value) {
  if (typeof value !== "string") return ""
  return value.length > 16 ? `${value.slice(0, 13)}...` : value
}
