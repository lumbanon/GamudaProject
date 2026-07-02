import { useEffect, useMemo, useState } from "react";
import kundasangImage from "../../assets/landing/kundasang.png";
import sabahDistricts from "../dashboard/sabahDistricts";
import CropPlanningPanel, { EnvironmentDataPanel } from "./CropPlanningPanel";
import PredictionInsightsPanel from "./PredictionInsightsPanel";
import SatellitePlanningMap from "./SatellitePlanningMap";
import {
  analyzeCropArea,
  fetchPredictionCrops,
  fetchPredictionEnvironment,
} from "./predictionApi";
import {
  calculatePolygonAreaHectares,
  detectDistrictFromPolygon,
} from "./predictionUtils";
import "./prediction-view.css";

export default function PredictionViews() {
  const [polygon, setPolygon] = useState(null);
  const [selectedCrop, setSelectedCrop] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [cropOptions, setCropOptions] = useState([]);
  const [districtOptions, setDistrictOptions] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [error, setError] = useState("");
  const [clearVersion, setClearVersion] = useState(0);

  const areaHectares = useMemo(
    () => calculatePolygonAreaHectares(polygon),
    [polygon],
  );
  const hasLocation = Boolean(polygon?.length || selectedDistrict);
  const districtChoices = useMemo(() => {
    const choices = new Set(districtOptions);
    if (selectedDistrict) choices.add(selectedDistrict);
    return [...choices].sort((a, b) => a.localeCompare(b));
  }, [districtOptions, selectedDistrict]);
  const canAnalyze = Boolean(
    selectedCrop && hasLocation && !isLoading && !isLoadingOptions,
  );

  useEffect(() => {
    let isMounted = true;

    async function loadPredictionOptions() {
      setIsLoadingOptions(true);
      setError("");

      try {
        const [crops, environment] = await Promise.all([
          fetchPredictionCrops(),
          fetchPredictionEnvironment(),
        ]);
        if (!isMounted) return;

        setCropOptions(Array.isArray(crops) ? crops : []);
        setDistrictOptions(environment?.available_districts || []);
      } catch (err) {
        if (isMounted) {
          setError(
            err.message || "Unable to load prediction data from the database.",
          );
        }
      } finally {
        if (isMounted) setIsLoadingOptions(false);
      }
    }

    loadPredictionOptions();

    return () => {
      isMounted = false;
    };
  }, []);

  function handlePolygonChange(nextPolygon) {
    const detectedDistrict = detectDistrictFromPolygon(
      nextPolygon,
      sabahDistricts.features,
    );
    setPolygon(nextPolygon);
    setSelectedDistrict(detectedDistrict);
    setAnalysisResult(null);
    setError("");
  }

  function handleCropChange(nextCrop) {
    setSelectedCrop(nextCrop);
    setAnalysisResult(null);
    setError("");
  }

  function handleDistrictChange(nextDistrict) {
    setSelectedDistrict(nextDistrict);
    setAnalysisResult(null);
    setError("");
  }

  function handleClearArea() {
    setPolygon(null);
    setSelectedDistrict("");
    setAnalysisResult(null);
    setError("");
    setClearVersion((version) => version + 1);
  }

  async function handleAnalyze() {
    if (!canAnalyze) return;

    setIsLoading(true);
    setError("");
    setAnalysisResult(null);

    try {
      const result = await analyzeCropArea({
        crop: selectedCrop,
        district: selectedDistrict,
        polygon,
      });
      setAnalysisResult(result);
    } catch (err) {
      setError(err.message || "Unable to analyze this farm area right now.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="prediction-studio-page">
      <section className="planning-studio-layout">
        <div className="satellite-workspace">
          <SatellitePlanningMap
            clearVersion={clearVersion}
            district={selectedDistrict}
            key={clearVersion}
            polygon={polygon}
            onPolygonChange={handlePolygonChange}
          />

          <div className="prediction-content-card">
            <img
              className="prediction-hero-image"
              src={kundasangImage}
              alt=""
              aria-hidden="true"
            />

            <section className="prediction-analyzer-hero">
              <header className="prediction-studio-header">
                <span className="hero-leaf-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M19.7 3.1c-5.8.2-10 3.1-12.4 7.3-1.7 3-2.2 6.1-2.1 8.6 2.6.1 5.8-.4 8.7-2.1 4.1-2.4 7-6.6 7.1-12.4 0-.8-.5-1.4-1.3-1.4Z" />
                    <path d="M4.4 14.9C2.8 12.4 2 9.6 2 6.6c3.6 0 6.3 1 8.3 2.7" />
                    <path d="M6.2 18.4c2.9-4.8 6.7-8.6 11.6-11.5" />
                  </svg>
                </span>

                <h1>Farm Area Analyzer</h1>

                <p>
                  Select your farm details to analyze the area and get started.
                </p>
              </header>

              <CropPlanningPanel
                areaHectares={areaHectares}
                canAnalyze={canAnalyze}
                cropOptions={cropOptions}
                districtOptions={districtChoices}
                hasLocation={hasLocation}
                hasPolygon={Boolean(polygon?.length)}
                isLoading={isLoading}
                isLoadingOptions={isLoadingOptions}
                selectedCrop={selectedCrop}
                selectedDistrict={selectedDistrict}
                onAnalyze={handleAnalyze}
                onClearArea={handleClearArea}
                onCropChange={handleCropChange}
                onDistrictChange={handleDistrictChange}
              />
            </section>

            <div className="prediction-report-stack">
              <PredictionInsightsPanel
                error={error}
                isLoading={isLoading}
                result={analysisResult}
              />

              <EnvironmentDataPanel
                isLoading={isLoading}
                result={analysisResult}
              />
            </div>
          </div>

          <div className="prediction-security-note">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 3.2 5.3 5.9v5.2c0 4.1 2.6 7.8 6.7 9.7 4.1-1.9 6.7-5.6 6.7-9.7V5.9L12 3.2Z" />
              <path d="m8.9 12.1 2 2 4.3-4.4" />
            </svg>

            <span>
              Your data is secure and used only for analysis purposes.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
