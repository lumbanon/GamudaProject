import { useCallback, useEffect, useMemo, useState } from "react"
import {
  deleteAnalysisHistory,
  fetchAnalysisHistory,
  renameAnalysisHistory,
  restoreAnalysisHistory,
} from "./historyApi"
import "./history-view.css"

const INITIAL_FILTERS = {
  search: "",
  crop: "",
  district: "",
  date_from: "",
  date_to: "",
  min_score: "",
  max_score: "",
  sort: "created_at:desc",
}

export default function PredictionHistoryPanel({
  cropOptions = [],
  districtOptions = [],
  onRestore,
  onSelectHistory,
  onStartNewAnalysis,
}) {
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS)
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState({ items: [], total: 0, pages: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState("")
  const [editingId, setEditingId] = useState("")
  const [editingName, setEditingName] = useState("")
  const [confirmingDeleteId, setConfirmingDeleteId] = useState("")
  const [error, setError] = useState("")

  const query = useMemo(() => {
    const [sort_by, sort_order] = appliedFilters.sort.split(":")
    return {
      ...Object.fromEntries(
        Object.entries(appliedFilters).filter(
          ([key, value]) => key !== "sort" && value !== "",
        ),
      ),
      sort_by,
      sort_order,
      page,
      page_size: 12,
    }
  }, [appliedFilters, page])

  const requestHistory = useCallback(
    () => fetchAnalysisHistory(query),
    [query],
  )

  useEffect(() => {
    let isActive = true

    requestHistory()
      .then((nextHistory) => {
        if (!isActive) return
        setHistory(nextHistory)
        setError("")
      })
      .catch((requestError) => {
        if (!isActive) return
        setHistory({ items: [], total: 0, pages: 0 })
        setError(requestError.message || "Unable to load prediction history.")
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [requestHistory])

  function applyFilters(event) {
    event.preventDefault()
    if (
      filters.date_from &&
      filters.date_to &&
      filters.date_from > filters.date_to
    ) {
      setError("Please choose a start date that is on or before the end date.")
      return
    }

    setIsLoading(true)
    setError("")
    setPage(1)
    setAppliedFilters({ ...filters })
  }

  async function reuseRecord(record) {
    setBusyId(record.id)
    setError("")
    try {
      const restoration = await restoreAnalysisHistory(record.id)
      onRestore(restoration)
    } catch (requestError) {
      setError(requestError.message || "Unable to restore this boundary.")
      setBusyId("")
    }
  }

  function startRenaming(record) {
    setConfirmingDeleteId("")
    setEditingId(record.id)
    setEditingName(record.name || "")
    setError("")
  }

  function cancelRenaming() {
    setEditingId("")
    setEditingName("")
  }

  async function renameRecord(event, record) {
    event.preventDefault()
    const nextName = editingName.trim()
    if (!nextName) {
      setError("Please enter a name for this analysis.")
      return
    }

    setBusyId(record.id)
    setError("")
    try {
      await renameAnalysisHistory(record.id, nextName)
      setHistory(await requestHistory())
      cancelRenaming()
    } catch (requestError) {
      setError(requestError.message || "Unable to rename this analysis.")
    } finally {
      setBusyId("")
    }
  }

  async function deleteRecord(record) {
    setBusyId(record.id)
    setError("")
    try {
      await deleteAnalysisHistory(record.id)
      setConfirmingDeleteId("")
      if (history.items.length === 1 && page > 1) {
        setIsLoading(true)
        setPage((currentPage) => currentPage - 1)
      } else {
        setHistory(await requestHistory())
      }
    } catch (requestError) {
      setError(requestError.message || "Unable to delete this analysis.")
    } finally {
      setBusyId("")
    }
  }

  return (
    <section
      className="prediction-history-panel"
      aria-label="Prediction history"
    >
      <header className="history-panel-header">
        <div>
          <span className="history-eyebrow">Saved work</span>
          <h2>Previous farm analyses</h2>
          <p>
            Review original snapshots or restore a boundary for a new analysis.
          </p>
        </div>
        <button type="button" onClick={onStartNewAnalysis}>
          Start New Analysis
        </button>
      </header>

      <form className="history-filters" onSubmit={applyFilters}>
        <HistoryField label="Search name">
          <input
            type="search"
            value={filters.search}
            onChange={(event) =>
              setFilters({ ...filters, search: event.target.value })
            }
            placeholder="e.g. Ranau north farm"
          />
        </HistoryField>
        <HistoryField label="Crop">
          <select
            value={filters.crop}
            onChange={(event) =>
              setFilters({ ...filters, crop: event.target.value })
            }
          >
            <option value="">All crops</option>
            {cropOptions.map((crop) => (
              <option value={crop.name} key={crop.id || crop.name}>
                {crop.name}
              </option>
            ))}
          </select>
        </HistoryField>
        <HistoryField label="District">
          <select
            value={filters.district}
            onChange={(event) =>
              setFilters({ ...filters, district: event.target.value })
            }
          >
            <option value="">All districts</option>
            {districtOptions.map((district) => (
              <option value={district} key={district}>
                {district}
              </option>
            ))}
          </select>
        </HistoryField>
        <HistoryField label="From date">
          <input
            type="date"
            value={filters.date_from}
            onChange={(event) =>
              setFilters({ ...filters, date_from: event.target.value })
            }
          />
        </HistoryField>
        <HistoryField label="To date">
          <input
            type="date"
            value={filters.date_to}
            onChange={(event) =>
              setFilters({ ...filters, date_to: event.target.value })
            }
          />
        </HistoryField>
        <HistoryField label="Minimum score">
          <input
            type="number"
            min="0"
            max="100"
            value={filters.min_score}
            onChange={(event) =>
              setFilters({ ...filters, min_score: event.target.value })
            }
          />
        </HistoryField>
        <HistoryField label="Maximum score">
          <input
            type="number"
            min="0"
            max="100"
            value={filters.max_score}
            onChange={(event) =>
              setFilters({ ...filters, max_score: event.target.value })
            }
          />
        </HistoryField>
        <HistoryField label="Sort">
          <select
            value={filters.sort}
            onChange={(event) =>
              setFilters({ ...filters, sort: event.target.value })
            }
          >
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="score:desc">Highest score</option>
            <option value="area:desc">Largest area</option>
            <option value="name:asc">Name A–Z</option>
          </select>
        </HistoryField>
        <div className="history-filter-actions">
          <button type="submit">Apply filters</button>
          <button
            type="button"
            className="history-secondary-button"
            onClick={() => {
              setIsLoading(true)
              setError("")
              setFilters(INITIAL_FILTERS)
              setAppliedFilters({ ...INITIAL_FILTERS })
              setPage(1)
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {error && (
        <div className="history-state history-error-state">{error}</div>
      )}
      {isLoading && (
        <div className="history-state">Loading saved analyses...</div>
      )}
      {!isLoading && !error && history.items.length === 0 && (
        <div className="history-state">
          <strong>No saved analyses found</strong>
          <p>Complete an AI prediction and select “Save to History”.</p>
          <button type="button" onClick={onStartNewAnalysis}>
            Analyze a farm area
          </button>
        </div>
      )}

      {!isLoading && history.items.length > 0 && (
        <>
          <section className="history-card-grid" aria-label="Saved analyses">
            {history.items.map((record) => (
              <article className="history-card" key={record.id}>
                <div className="history-card-heading">
                  <div>
                    <span>{formatDate(record.created_at)}</span>
                    {editingId === record.id ? (
                      <form
                        className="history-inline-rename"
                        onSubmit={(event) => renameRecord(event, record)}
                      >
                        <input
                          type="text"
                          value={editingName}
                          onChange={(event) =>
                            setEditingName(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") cancelRenaming()
                          }}
                          aria-label="Analysis name"
                          maxLength={120}
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={
                            busyId === record.id || !editingName.trim()
                          }
                        >
                          {busyId === record.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="history-inline-cancel"
                          onClick={cancelRenaming}
                          disabled={busyId === record.id}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <h3>{record.name || "Untitled analysis"}</h3>
                    )}
                  </div>
                  <span
                    className={`history-status ${record.analysis_status}`}
                  >
                    {record.analysis_status}
                  </span>
                </div>
                <dl className="history-metadata">
                  <HistoryMetadata
                    label="Crop"
                    value={record.selected_crop || "Not selected"}
                  />
                  <HistoryMetadata
                    label="District"
                    value={record.district || "Not detected"}
                  />
                  <HistoryMetadata
                    label="Land area"
                    value={`${formatNumber(record.land_area_hectares)} ha`}
                  />
                  <HistoryMetadata
                    label="Suitability"
                    value={
                      record.suitability_score == null
                        ? "N/A"
                        : `${record.suitability_score}/100`
                    }
                  />
                  <HistoryMetadata
                    label="Confidence"
                    value={record.confidence_level || "N/A"}
                  />
                </dl>
                <div className="history-card-actions">
                  <button
                    type="button"
                    onClick={() => onSelectHistory(record.id)}
                  >
                    View details
                  </button>
                  <button
                    type="button"
                    onClick={() => reuseRecord(record)}
                    disabled={busyId === record.id}
                  >
                    {busyId === record.id
                      ? "Restoring..."
                      : "Restore & reuse"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startRenaming(record)}
                    disabled={busyId === record.id || editingId === record.id}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="history-delete-button"
                    onClick={() => {
                      cancelRenaming()
                      setConfirmingDeleteId(record.id)
                      setError("")
                    }}
                    disabled={
                      busyId === record.id ||
                      confirmingDeleteId === record.id
                    }
                  >
                    Delete
                  </button>
                  {confirmingDeleteId === record.id && (
                    <div
                      className="history-inline-delete"
                      role="group"
                      aria-label={`Confirm deletion of ${
                        record.name || "Untitled analysis"
                      }`}
                    >
                      <span>Delete this saved analysis? This cannot be undone.</span>
                      <button
                        type="button"
                        className="history-confirm-delete-button"
                        onClick={() => deleteRecord(record)}
                        disabled={busyId === record.id}
                        autoFocus
                      >
                        {busyId === record.id
                          ? "Deleting..."
                          : "Confirm delete"}
                      </button>
                      <button
                        type="button"
                        className="history-cancel-delete-button"
                        onClick={() => setConfirmingDeleteId("")}
                        disabled={busyId === record.id}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>

          <nav
            className="history-pagination"
            aria-label="Prediction history pages"
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                setIsLoading(true)
                setError("")
                setPage((currentPage) => currentPage - 1)
              }}
            >
              Previous
            </button>
            <span>
              Page {page} of {history.pages || 1} · {history.total} records
            </span>
            <button
              type="button"
              disabled={page >= history.pages}
              onClick={() => {
                setIsLoading(true)
                setError("")
                setPage((currentPage) => currentPage + 1)
              }}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  )
}

function HistoryField({ children, label }) {
  return (
    <label className="history-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function HistoryMetadata({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number)
    ? number.toLocaleString("en-MY", { maximumFractionDigits: 2 })
    : "N/A"
}
