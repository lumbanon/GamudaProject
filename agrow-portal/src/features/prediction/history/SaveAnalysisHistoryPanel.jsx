import { useRef, useState } from "react"
import { saveAnalysisHistory } from "./historyApi"
import { buildHistoryPayload } from "./historyPayload"
import { getHistorySaveBlockReason } from "./historySavePolicy"
import "./history-view.css"

export default function SaveAnalysisHistoryPanel({
  district,
  onViewHistory,
  polygon,
  result,
  selectedCrop,
}) {
  const [name, setName] = useState("")
  const [savingResult, setSavingResult] = useState(null)
  const [errorState, setErrorState] = useState({ result: null, message: "" })
  const [savedState, setSavedState] = useState({ result: null, record: null })
  const idempotencyKeysRef = useRef(new WeakMap())
  const isSaving = savingResult === result
  const error = errorState.result === result ? errorState.message : ""
  const savedRecord = savedState.result === result ? savedState.record : null
  const saveBlockReason = getHistorySaveBlockReason(result)
  const canSave = Boolean(
    polygon?.length >= 4 &&
      result &&
      !saveBlockReason &&
      !isSaving &&
      !savedRecord,
  )

  async function handleSave() {
    if (!canSave) return
    setSavingResult(result)
    setErrorState({ result, message: "" })
    try {
      const idempotencyKey =
        idempotencyKeysRef.current.get(result) || createIdempotencyKey()
      idempotencyKeysRef.current.set(result, idempotencyKey)
      const record = await saveAnalysisHistory(
        buildHistoryPayload({
          district,
          name,
          polygon,
          result,
          selectedCrop,
        }),
        idempotencyKey,
      )
      setSavedState({ result, record })
    } catch (requestError) {
      setErrorState({
        result,
        message: requestError.message || "Unable to save this analysis.",
      })
    } finally {
      setSavingResult(null)
    }
  }

  if (!result) return null

  return (
    <section className="save-history-panel">
      <div>
        <span className="history-eyebrow">Analysis history</span>
        <strong>Save this completed analysis</strong>
        <small>
          {saveBlockReason ||
            "The current boundary, results, and dataset snapshot will be preserved."}
        </small>
      </div>
      <label>
        <span>Optional name</span>
        <input
          disabled={Boolean(saveBlockReason)}
          value={name}
          maxLength={160}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Ranau north farm"
        />
      </label>
      <button type="button" onClick={handleSave} disabled={!canSave}>
        {saveBlockReason
          ? "Saving Not Allowed"
          : isSaving
            ? "Saving..."
            : savedRecord
              ? "Saved to History"
              : "Save to History"}
      </button>
      {error && <p className="history-inline-error">{error}</p>}
      {savedRecord && (
        <div className="history-inline-success">
          <span role="status">Analysis saved to history.</span>
          <button type="button" onClick={onViewHistory}>
            View History
          </button>
        </div>
      )}
    </section>
  )
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `history-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
