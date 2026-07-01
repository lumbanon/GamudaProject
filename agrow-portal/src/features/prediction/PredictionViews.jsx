import { useMemo, useState } from "react"
import CropPlanningPanel from "./CropPlanningPanel"
import SatellitePlanningMap from "./SatellitePlanningMap"
import { analyzeCropArea } from "./predictionApi"
import { calculatePolygonAreaHectares } from "./predictionUtils"
import "./prediction-view.css"

export default function PredictionViews() {
  const [polygon, setPolygon] = useState(null)
  const [selectedCrop, setSelectedCrop] = useState("")
  const [analysisResult, setAnalysisResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [clearVersion, setClearVersion] = useState(0)

  const areaHectares = useMemo(() => calculatePolygonAreaHectares(polygon), [polygon])
  const canAnalyze = Boolean(selectedCrop && polygon?.length && !isLoading)

  function handlePolygonChange(nextPolygon) {
    setPolygon(nextPolygon)
    setAnalysisResult(null)
    setError("")
  }

  function handleCropChange(nextCrop) {
    setSelectedCrop(nextCrop)
    setAnalysisResult(null)
    setError("")
  }

  function handleClearArea() {
    setPolygon(null)
    setAnalysisResult(null)
    setError("")
    setClearVersion((version) => version + 1)
  }

  async function handleAnalyze() {
    if (!canAnalyze) return

    setIsLoading(true)
    setError("")
    setAnalysisResult(null)

    try {
      const result = await analyzeCropArea({ crop: selectedCrop, polygon })
      setAnalysisResult(result)
    } catch (err) {
      setError(err.message || "Unable to analyze this farm area right now.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="prediction-studio-page">
      <header className="prediction-studio-header">
        <div>
          <span>AI Predictions / Satellite Imagery</span>
          <h1>Farm Planning Studio</h1>
        </div>
        <p>Draw a field boundary, choose a crop, and generate an honest suitability plan from Agrow GIS data.</p>
      </header>

      <section className="planning-studio-layout">
        <div className="satellite-workspace">
          <SatellitePlanningMap
            clearVersion={clearVersion}
            key={clearVersion}
            polygon={polygon}
            onPolygonChange={handlePolygonChange}
          />
        </div>

        <CropPlanningPanel
          areaHectares={areaHectares}
          canAnalyze={canAnalyze}
          error={error}
          hasPolygon={Boolean(polygon?.length)}
          isLoading={isLoading}
          result={analysisResult}
          selectedCrop={selectedCrop}
          onAnalyze={handleAnalyze}
          onClearArea={handleClearArea}
          onCropChange={handleCropChange}
        />
      </section>
    </div>
  )
}
