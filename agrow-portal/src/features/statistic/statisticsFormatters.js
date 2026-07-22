const DECIMAL_FORMATTER = new Intl.NumberFormat("en-MY", {
  maximumFractionDigits: 2,
})

const YIELD_FORMATTER = new Intl.NumberFormat("en-MY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const INTEGER_FORMATTER = new Intl.NumberFormat("en-MY", {
  maximumFractionDigits: 0,
})

const COMPACT_FORMATTER = new Intl.NumberFormat("en-MY", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  currencyDisplay: "code",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback

  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function formatArea(value) {
  return `${DECIMAL_FORMATTER.format(toFiniteNumber(value))} ha`
}

export function formatProduction(value) {
  return `${DECIMAL_FORMATTER.format(toFiniteNumber(value))} tonnes`
}

export function formatCurrency(value) {
  return CURRENCY_FORMATTER.format(toFiniteNumber(value))
}

export function formatYield(value) {
  return `${YIELD_FORMATTER.format(toFiniteNumber(value))} t/ha`
}

export function formatInteger(value) {
  return INTEGER_FORMATTER.format(toFiniteNumber(value))
}

export function formatCompactNumber(value) {
  return COMPACT_FORMATTER.format(toFiniteNumber(value))
}
