export function getHistorySaveBlockReason(result) {
  if (!result) return ""
  if (result.allowed === false || result.reserved_forest === true || result.blocked_reason === "reserved_forest") {
    return "This analysis cannot be saved because the selected area is inside a forest reserve."
  }
  return ""
}
