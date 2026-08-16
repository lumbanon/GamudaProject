import assert from "node:assert/strict"
import test from "node:test"

import {
  getHistorySaveBlockReason,
  hasUsableGeminiInsight,
} from "./historySavePolicy.js"

const generatedInsight = {
  crop_suitability_summary: "The site can support the selected crop.",
  fallback_used: false,
  model: "gemini-test",
}

test("an isolated detected building does not block history saving", () => {
  const reason = getHistorySaveBlockReason({
    satellite_building_analysis: {
      buildings_detected: true,
      is_built_up: false,
      estimated_built_up_percent: 2,
    },
  })

  assert.equal(reason, "")
})

test("materially built-up land is blocked without Gemini insight", () => {
  const reason = getHistorySaveBlockReason({
    satellite_building_analysis: { is_built_up: true },
  })

  assert.match(reason, /materially built-up area/)
})

test("generated Gemini insight allows a materially built-up result to be saved", () => {
  const reason = getHistorySaveBlockReason({
    satellite_building_analysis: { is_built_up: true },
    genai_insight: generatedInsight,
  })

  assert.equal(reason, "")
})

test("fallback insight does not override the materially built-up restriction", () => {
  assert.equal(
    hasUsableGeminiInsight({
      crop_suitability_summary: "Locally generated fallback text.",
      fallback_used: true,
    }),
    false,
  )
})

test("forest-reserve results remain blocked even with Gemini insight", () => {
  const reason = getHistorySaveBlockReason({
    allowed: false,
    genai_insight: generatedInsight,
  })

  assert.match(reason, /forest reserve/)
})
