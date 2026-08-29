import { useEffect, useMemo, useRef, useState } from "react"

export default function SearchableSelect({
  id,
  label,
  values = [],
  options,
  allLabel,
  searchPlaceholder,
  clearLabel = "Clear selection",
  maxSelections = Number.POSITIVE_INFINITY,
  optionStatuses = {},
  disabledOptions = [],
  disabledOptionReason = "Unavailable",
  disabled = false,
  onChange,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const optionRefs = useRef([])
  const isExpanded = isOpen && !disabled
  const selectedValues = useMemo(() => deduplicateValues(values), [values])
  const selectedValueKeys = useMemo(
    () => new Set(selectedValues.map(normalizeValue)),
    [selectedValues],
  )
  const disabledOptionKeys = useMemo(
    () => new Set(disabledOptions.map(normalizeValue)),
    [disabledOptions],
  )
  const hasReachedLimit = selectedValues.length >= maxSelections
  const normalizedOptionStatuses = useMemo(
    () =>
      new Map(
        Object.entries(optionStatuses).map(([option, status]) => [
          normalizeValue(option),
          String(status || "").trim(),
        ]),
      ),
    [optionStatuses],
  )

  const selectableOptions = useMemo(
    () =>
      deduplicateValues(options).map((option) => {
        const optionKey = normalizeValue(option)
        const isSelected = selectedValueKeys.has(optionKey)
        const isUnavailable = disabledOptionKeys.has(optionKey)
        return {
          value: option,
          label: option,
          selected: isSelected,
          unavailable: isUnavailable,
          limitDisabled: hasReachedLimit && !isSelected,
          disabled: isUnavailable || (hasReachedLimit && !isSelected),
          status: normalizedOptionStatuses.get(optionKey) || "",
        }
      }),
    [
      disabledOptionKeys,
      hasReachedLimit,
      normalizedOptionStatuses,
      options,
      selectedValueKeys,
    ],
  )
  const normalizedQuery = normalizeValue(searchQuery.trim())
  const filteredOptions = useMemo(
    () =>
      selectableOptions.filter((option) =>
        normalizeValue(option.label).includes(normalizedQuery),
      ),
    [normalizedQuery, selectableOptions],
  )
  const effectiveActiveIndex = getEffectiveActiveIndex(
    filteredOptions,
    activeIndex,
  )
  const activeOptionId = filteredOptions[effectiveActiveIndex]
    ? `${id}-option-${effectiveActiveIndex}`
    : undefined
  const listboxId = `${id}-listbox`
  const labelId = `${id}-label`
  const limitMessageId = `${id}-limit-message`
  const pluralLabel = getPluralLabel(label)

  useEffect(() => {
    if (!isExpanded) return undefined

    const focusFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    const handleOutsidePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false)
        setSearchQuery("")
      }
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener("pointerdown", handleOutsidePointerDown)
    }
  }, [isExpanded])

  useEffect(() => {
    if (!isExpanded || effectiveActiveIndex < 0) return
    optionRefs.current[effectiveActiveIndex]?.scrollIntoView({ block: "nearest" })
  }, [effectiveActiveIndex, isExpanded])

  const openMenu = () => {
    if (disabled || isExpanded) return
    setActiveIndex(getInitialActiveIndex(selectableOptions))
    setIsOpen(true)
  }

  const closeMenu = () => {
    setIsOpen(false)
    setSearchQuery("")
  }

  const removeValue = (valueToRemove) => {
    const valueKey = normalizeValue(valueToRemove)
    onChange(
      selectedValues.filter((value) => normalizeValue(value) !== valueKey),
    )
  }

  const selectOption = (option) => {
    if (!option || option.disabled) return

    if (option.selected) {
      removeValue(option.value)
    } else if (!hasReachedLimit) {
      onChange([...selectedValues, option.value])
    }

    setSearchQuery("")
    setActiveIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const handleInputChange = (event) => {
    if (!isExpanded) setIsOpen(true)
    setSearchQuery(event.target.value)
    setActiveIndex(0)
  }

  const handleInputKeyDown = (event) => {
    if (
      event.key === "Backspace" &&
      searchQuery.length === 0 &&
      selectedValues.length
    ) {
      event.preventDefault()
      removeValue(selectedValues.at(-1))
      return
    }

    if (!isExpanded) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter"
      ) {
        event.preventDefault()
        openMenu()
      } else if (
        event.key.length === 1 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault()
        setSearchQuery(event.key)
        setActiveIndex(0)
        setIsOpen(true)
      }
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu()
      return
    }

    if (event.key === "Tab") {
      closeMenu()
      return
    }

    const enabledIndices = getEnabledOptionIndices(filteredOptions)
    if (!enabledIndices.length) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex(
        getAdjacentEnabledIndex(enabledIndices, effectiveActiveIndex, 1),
      )
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex(
        getAdjacentEnabledIndex(enabledIndices, effectiveActiveIndex, -1),
      )
      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(enabledIndices[0])
      return
    }

    if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(enabledIndices.at(-1))
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      selectOption(filteredOptions[effectiveActiveIndex])
    }
  }

  const inputPlaceholder = isExpanded
    ? searchPlaceholder
    : selectedValues.length
      ? `${selectedValues.length} selected`
      : allLabel

  return (
    <div className="statistics-filter-field">
      <div className="statistics-filter-label-row">
        <label id={labelId} htmlFor={id}>{label}</label>
        {selectedValues.length > 0 && (
          <button
            className="statistics-filter-clear"
            type="button"
            disabled={disabled}
            onClick={() => onChange([])}
          >
            {clearLabel}
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        className={`statistics-searchable-select${isExpanded ? " statistics-searchable-select--open" : ""}`}
      >
        <svg
          className="statistics-select-search-icon"
          viewBox="0 0 20 20"
          width="17"
          height="17"
          aria-hidden="true"
        >
          <circle cx="8.5" cy="8.5" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="m12.4 12.4 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
        </svg>
        <input
          ref={inputRef}
          id={id}
          className="statistics-select-input"
          type="text"
          role="combobox"
          value={searchQuery}
          placeholder={inputPlaceholder}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={isExpanded}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-activedescendant={isExpanded ? activeOptionId : undefined}
          aria-describedby={hasReachedLimit ? limitMessageId : undefined}
          disabled={disabled}
          onFocus={openMenu}
          onClick={openMenu}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
        />
        <svg
          className="statistics-select-chevron"
          viewBox="0 0 20 20"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>

        {isExpanded && (
          <div className="statistics-select-panel">
            <ul
              id={listboxId}
              className={`statistics-select-options${filteredOptions.length ? "" : " statistics-select-options--empty"}`}
              role="listbox"
              aria-labelledby={labelId}
              aria-multiselectable="true"
            >
              {filteredOptions.map((option, index) => (
                <li
                  ref={(element) => {
                    optionRefs.current[index] = element
                  }}
                  id={`${id}-option-${index}`}
                  className={`statistics-select-option${index === effectiveActiveIndex ? " statistics-select-option--active" : ""}${option.selected ? " statistics-select-option--selected" : ""}${option.disabled ? " statistics-select-option--disabled" : ""}`}
                  role="option"
                  aria-selected={option.selected}
                  aria-disabled={option.disabled || undefined}
                  key={normalizeValue(option.value)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index)
                  }}
                  onClick={() => selectOption(option)}
                >
                  <span>{option.label}</span>
                  {option.disabled ? (
                    <small className="statistics-select-option-status">
                      {option.unavailable
                        ? disabledOptionReason
                        : `Maximum ${maxSelections} selected`}
                    </small>
                  ) : option.status || option.selected ? (
                    <span className="statistics-select-option-meta">
                      {option.status && (
                        <small className="statistics-select-option-status">
                          {option.status}
                        </small>
                      )}
                      {option.selected && (
                        <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                          <path d="m4.5 10.5 3.25 3.25 7.75-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        </svg>
                      )}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>

            {!filteredOptions.length && (
              <p className="statistics-select-empty" role="status">
                No {label.toLocaleLowerCase()} found
              </p>
            )}

            <span className="statistics-sr-only" role="status" aria-live="polite">
              {getAvailabilityMessage(
                filteredOptions,
                label,
                selectedValues.length,
                maxSelections,
              )}
            </span>
          </div>
        )}
      </div>

      {selectedValues.length > 0 && (
        <ul className="statistics-select-chip-list" aria-label={`Selected ${pluralLabel}`}>
          {selectedValues.map((value) => (
            <li className="statistics-select-chip" key={normalizeValue(value)}>
              <span>{value}</span>
              <button
                type="button"
                aria-label={`Remove ${value}`}
                disabled={disabled}
                onClick={() => removeValue(value)}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasReachedLimit && (
        <p id={limitMessageId} className="statistics-select-limit" role="status">
          Maximum {maxSelections} {pluralLabel} selected. Remove one to add another.
        </p>
      )}
    </div>
  )
}

function normalizeValue(value) {
  return String(value).trim().toLocaleLowerCase()
}

function getPluralLabel(label) {
  const normalizedLabel = label.toLocaleLowerCase()
  return normalizedLabel.endsWith("s")
    ? normalizedLabel
    : `${normalizedLabel}s`
}

function deduplicateValues(values) {
  if (!Array.isArray(values)) return []

  const uniqueValues = new Map()
  values.forEach((value) => {
    if (typeof value !== "string" || !value.trim()) return
    const trimmedValue = value.trim()
    const key = normalizeValue(trimmedValue)
    if (!uniqueValues.has(key)) uniqueValues.set(key, trimmedValue)
  })
  return [...uniqueValues.values()]
}

function getInitialActiveIndex(options) {
  const firstUnselectedIndex = options.findIndex(
    (option) => !option.selected && !option.disabled,
  )
  return firstUnselectedIndex >= 0
    ? firstUnselectedIndex
    : getEffectiveActiveIndex(options, 0)
}

function getEffectiveActiveIndex(options, activeIndex) {
  if (options[activeIndex] && !options[activeIndex].disabled) {
    return activeIndex
  }

  return options.findIndex((option) => !option.disabled)
}

function getEnabledOptionIndices(options) {
  return options.reduce((indices, option, index) => {
    if (!option.disabled) indices.push(index)
    return indices
  }, [])
}

function getAdjacentEnabledIndex(enabledIndices, activeIndex, direction) {
  const currentPosition = enabledIndices.indexOf(activeIndex)
  if (currentPosition === -1) {
    return direction > 0 ? enabledIndices[0] : enabledIndices.at(-1)
  }

  const nextPosition =
    (currentPosition + direction + enabledIndices.length) %
    enabledIndices.length
  return enabledIndices[nextPosition]
}

function getAvailabilityMessage(
  options,
  label,
  selectedCount,
  maxSelections,
) {
  const selectableCount = options.filter((option) => !option.disabled).length
  const unavailableCount = options.length - selectableCount
  const selectableLabel = selectableCount === 1 ? "option" : "options"
  const unavailableMessage = unavailableCount
    ? ` ${unavailableCount} matching ${label.toLocaleLowerCase()} ${unavailableCount === 1 ? "is" : "are"} unavailable.`
    : ""
  const selectionMessage = ` ${selectedCount} of ${maxSelections} selected.`

  return `${selectableCount} selectable ${selectableLabel}.${unavailableMessage}${selectionMessage}`
}
