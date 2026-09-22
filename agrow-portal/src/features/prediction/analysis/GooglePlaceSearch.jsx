import { useEffect, useId, useRef, useState } from "react"
import { normalizeGoogleMapQuery, normalizeGooglePlaces, SABAH_BOUNDS } from "./googleMaps"

export default function GooglePlaceSearch({ maps, disabled, onSelect }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(-1)
  const requestId = useRef(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()
  useEffect(() => () => { requestId.current += 1 }, [])
  useEffect(() => { listRef.current?.children[active]?.scrollIntoView({ block: "nearest" }) }, [active])

  function select(result) {
    requestId.current += 1
    inputRef.current?.focus()
    setLoading(false); setExpanded(false); setQuery(result.name)
    setStatus("Location found. Start a boundary on the map to select your planting area.")
    onSelect(result)
  }
  async function search(event) {
    event.preventDefault()
    if (expanded && active >= 0 && results[active]) { select(results[active]); return }
    const address = normalizeGoogleMapQuery(query)
    if (!address || !maps || disabled) return
    const id = ++requestId.current
    setLoading(true); setExpanded(true); setResults([]); setActive(-1); setStatus("Searching Google Maps…")
    let timeout
    try {
      const response = await Promise.race([
        new maps.Geocoder().geocode({ address, bounds: SABAH_BOUNDS, region: "my", componentRestrictions: { country: "MY" } }),
        new Promise((_, reject) => { timeout = window.setTimeout(() => reject(new Error("timeout")), 12000) }),
      ])
      if (id !== requestId.current) return
      const places = normalizeGooglePlaces(response.results)
      setResults(places)
      setStatus(places.length ? "Select a location to zoom in." : "No places found in Sabah. Try adding the town or district name.")
    } catch (error) {
      if (id !== requestId.current) return
      setStatus(error.code === "ZERO_RESULTS" ? "No places found. Try another spelling or add Sabah." : "Location search is unavailable. Please try again.")
    } finally {
      window.clearTimeout(timeout)
      if (id === requestId.current) setLoading(false)
    }
  }
  function edit(value) {
    requestId.current += 1
    setQuery(value); setResults([]); setStatus(""); setLoading(false); setExpanded(false); setActive(-1)
  }
  return <div className="google-place-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}>
    <form role="search" aria-label="Search Google Maps" className="google-map-search" onSubmit={search}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
      <input ref={inputRef} role="combobox" aria-label="Search Google Maps" value={query}
        onChange={(event) => edit(event.target.value)} onFocus={() => results.length && setExpanded(true)}
        aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-autocomplete="none"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Escape") { setExpanded(false); setActive(-1) }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
            event.preventDefault(); setExpanded(true)
            setActive((index) => event.key === "ArrowDown" ? (index + 1) % results.length : index <= 0 ? results.length - 1 : index - 1)
          }
        }} placeholder="Search Kampung, town, district, or address" maxLength={200} autoComplete="off" />
      {query && <button className="google-map-clear" type="button" aria-label="Clear location search" onClick={() => { edit(""); onSelect(null); inputRef.current?.focus() }}>×</button>}
      <button className="google-map-search-submit" type="submit" disabled={disabled || loading || !query.trim()}>Search</button>
    </form>
    {expanded && <div className="google-search-results">
      <ul id={listId} role="listbox" aria-label="Google location results" ref={listRef}>
        {results.map((result, index) => <li key={result.id} id={`${listId}-${index}`} role="option" aria-selected={active === index}
          onMouseDown={(event) => event.preventDefault()} onClick={() => select(result)}>{result.name}</li>)}
      </ul>
      <p role="status">{status}</p>
    </div>}
    {!expanded && status && <p className="google-map-help" role="status">{status}</p>}
  </div>
}
