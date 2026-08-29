import assert from "node:assert/strict"
import test from "node:test"
import {
  extractStatisticCropNames,
  normalizeStatisticCropOptions,
} from "./statisticsCropOptions.js"

test("normalizes ML support metadata without removing statistics crops", () => {
  const payloadCrops = [
    {
      name: "Banana",
      ml_supported: true,
      prediction_crop_name: "Banana",
      ml_status: "supported",
      exclusion_reasons: [],
    },
    {
      name: "Paddy",
      ml_supported: false,
      prediction_crop_name: null,
      ml_status: "statistics_only",
      exclusion_reasons: ["no_model_artifact"],
    },
  ]

  const options = normalizeStatisticCropOptions(payloadCrops, [
    "Banana",
    "Paddy",
    "Rubber",
  ])

  assert.equal(options.length, 3)
  assert.deepEqual(options[0], {
    name: "Banana",
    mlSupported: true,
    predictionCropName: "Banana",
    mlStatus: "supported",
    exclusionReasons: [],
  })
  assert.deepEqual(options[1], {
    name: "Paddy",
    mlSupported: false,
    predictionCropName: null,
    mlStatus: "statistics_only",
    exclusionReasons: ["no_model_artifact"],
  })
  assert.equal(options[2].name, "Rubber")
  assert.equal(options[2].mlSupported, null)
})

test("extracts crop names from metadata for backward-compatible option merging", () => {
  assert.deepEqual(
    extractStatisticCropNames([
      { name: "  Cocoa " },
      { crop_name: "Coffee" },
      null,
    ]),
    ["Cocoa", "Coffee"],
  )
})
