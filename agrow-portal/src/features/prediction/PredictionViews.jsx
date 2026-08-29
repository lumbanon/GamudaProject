import { useEffect, useMemo, useRef, useState } from "react";
import heroLeafIcon from "../../assets/prediction/hero-leaf.svg?raw";
import securityShieldIcon from "../../assets/prediction/security-shield.svg?raw";
import kundasangImage from "../../assets/landing/kundasang.png";
import sabahDistricts from "../dashboard/sabahDistricts";
import PredictionHistoryDetail from "./history/PredictionHistoryDetail";
import PredictionHistoryPanel from "./history/PredictionHistoryPanel";
import SaveAnalysisHistoryPanel from "./history/SaveAnalysisHistoryPanel";
import { restoreHistoryIntoPrediction } from "./history/historyRestore";
import {
  APP_PREFERENCE_KEYS,
  useAppPreference,
  useAppPreferences,
} from "../../context/appPreferences";
import CropPlanningPanel, {
  EnvironmentDataPanel,
} from "./analysis/CropPlanningPanel";
import PredictionAssetIcon from "./analysis/PredictionAssetIcon";
import PredictionInsightsPanel from "./analysis/PredictionInsightsPanel";
import PredictionPageTabs from "./PredictionPageTabs";
import SatellitePlanningMap from "./analysis/SatellitePlanningMap";
import {
  analyzeCropArea,
  fetchPredictionCrops,
  fetchPredictionEnvironment,
  validateForestReserveArea,
} from "./analysis/predictionApi";
import {
  calculatePolygonAreaHectares,
  detectDistrictFromPolygon,
  formatFarmerFacingText,
} from "./analysis/predictionUtils";
import { DEFAULT_PREDICTION_TAB } from "./predictionTabs";
import "./prediction-view.css";

export default function PredictionViews() {
  const appPreferences = useAppPreferences();
  const satelliteMapRef = useRef(null);
  const analysisRequestIdRef = useRef(0);
  const [activeTab, setActiveTab] = useState(DEFAULT_PREDICTION_TAB);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [restoredFitVersion, setRestoredFitVersion] = useState(0);
  const [polygon, setPolygon] = useAppPreference(
    APP_PREFERENCE_KEYS.predictionPolygon,
    null,
  );
  const [selectedCrop, setSelectedCrop] = useAppPreference(
    APP_PREFERENCE_KEYS.predictionCrop,
    "",
  );
  const [selectedDistrict, setSelectedDistrict] = useAppPreference(
    APP_PREFERENCE_KEYS.predictionDistrict,
    "",
  );
  const [cropOptions, setCropOptions] = useState([]);
  const [cropCatalogStatus, setCropCatalogStatus] = useState("loading");
  const [districtOptions, setDistrictOptions] = useState([]);
  const [analysisResult, setAnalysisResult] = useAppPreference(
    APP_PREFERENCE_KEYS.predictionAnalysis,
    null,
  );
  const [forestReserveResult, setForestReserveResult] = useAppPreference(
    APP_PREFERENCE_KEYS.predictionForestReserve,
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [error, setError] = useState("");
  const [clearVersion, setClearVersion] = useAppPreference(
    APP_PREFERENCE_KEYS.predictionClearVersion,
    0,
  );

  const areaHectares = useMemo(
    () => calculatePolygonAreaHectares(polygon),
    [polygon],
  );
  const hasLocation = Boolean(polygon?.length || selectedDistrict);
  const cropNames = useMemo(
    () => cropOptions.map((crop) => crop.name),
    [cropOptions],
  );
  const canonicalSelectedCrop = useMemo(
    () => findCropName(cropNames, selectedCrop),
    [cropNames, selectedCrop],
  );
  const districtChoices = useMemo(() => {
    const choices = new Set(districtOptions);
    if (selectedDistrict) choices.add(selectedDistrict);
    return [...choices].sort((a, b) => a.localeCompare(b));
  }, [districtOptions, selectedDistrict]);
  const reserveStatus = analysisResult || forestReserveResult;
  const isReservedForestBlocked = Boolean(
    reserveStatus?.allowed === false ||
      reserveStatus?.blocked_reason === "reserved_forest",
  );
  const canAnalyze = Boolean(
    cropCatalogStatus === "ready" &&
      canonicalSelectedCrop &&
      hasLocation &&
      !isLoading &&
      !isLoadingOptions,
  );
  const displayedResult =
    analysisResult || (isReservedForestBlocked ? forestReserveResult : null);
  const reservedForestOverlay = normalizeReservedForestOverlay(
    reserveStatus?.reserved_forest_geojson ||
      reserveStatus?.reserved_overlap_geojson,
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
        setCropCatalogStatus("ready");
      } catch (err) {
        if (isMounted) {
          setCropCatalogStatus("error");
          setError(
            formatFarmerFacingText(err.message) || "Unable to load prediction data right now.",
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

  useEffect(() => {
    if (cropCatalogStatus !== "ready") return;

    if (selectedCrop && !canonicalSelectedCrop) {
      setSelectedCrop("");
      setAnalysisResult(null);
      return;
    }

    if (canonicalSelectedCrop && canonicalSelectedCrop !== selectedCrop) {
      setSelectedCrop(canonicalSelectedCrop);
    }

    const resultCrop = analysisResult?.crop;
    if (
      resultCrop &&
      normalizeCropName(resultCrop) !== normalizeCropName(canonicalSelectedCrop)
    ) {
      setAnalysisResult(null);
    }
  }, [
    analysisResult,
    canonicalSelectedCrop,
    cropCatalogStatus,
    cropNames,
    selectedCrop,
    setAnalysisResult,
    setSelectedCrop,
  ]);

  useEffect(() => {
    if (!polygon?.length) return undefined;

    let isMounted = true;

    async function validateSelectedArea() {
      try {
        const result = await validateForestReserveArea({ polygon });
        if (!isMounted) return;

        setForestReserveResult(result?.allowed === false ? result : null);
      } catch {
        if (isMounted) setForestReserveResult(null);
      }
    }

    validateSelectedArea();

    return () => {
      isMounted = false;
    };
  }, [polygon, setForestReserveResult]);

  function handlePolygonChange(nextPolygon) {
    invalidatePendingAnalysis();
    const detectedDistrict = detectDistrictFromPolygon(
      nextPolygon,
      sabahDistricts.features,
    );
    setPolygon(nextPolygon);
    setSelectedDistrict(detectedDistrict);
    setAnalysisResult(null);
    setForestReserveResult(null);
    setError("");
  }

  function handleCropChange(nextCrop) {
    invalidatePendingAnalysis();
    setSelectedCrop(nextCrop);
    setAnalysisResult(null);
    setError("");
  }

  function handleDistrictChange(nextDistrict) {
    invalidatePendingAnalysis();
    setSelectedDistrict(nextDistrict);
    setAnalysisResult(null);
    setError("");
  }

  function handleClearArea() {
    invalidatePendingAnalysis();
    setPolygon(null);
    setSelectedDistrict("");
    setAnalysisResult(null);
    setForestReserveResult(null);
    setError("");
    setRestoredFitVersion(0);
    setClearVersion((version) => version + 1);
  }

  async function handleAnalyze() {
    if (!canAnalyze) return;

    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;
    setIsLoading(true);
    setError("");
    setAnalysisResult(null);

    try {
      let satelliteImageDataUrl = null;
      if (polygon?.length) {
        try {
          satelliteImageDataUrl =
            (await satelliteMapRef.current?.captureSelectedArea?.()) || null;
          if (analysisRequestIdRef.current !== requestId) return;
        } catch (captureError) {
          console.warn("Satellite crop could not be prepared for Gemini vision.", captureError);
        }
      }
      if (analysisRequestIdRef.current !== requestId) return;

      const result = await analyzeCropArea({
        crop: canonicalSelectedCrop,
        district: selectedDistrict,
        polygon,
        satelliteImageDataUrl,
      });
      if (analysisRequestIdRef.current === requestId) {
        setAnalysisResult(result);
      }
    } catch (err) {
      if (analysisRequestIdRef.current === requestId) {
        setError(formatFarmerFacingText(err.message) || "Unable to analyze this farm area right now.");
      }
    } finally {
      if (analysisRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }

  function handleTabChange(nextTab) {
    setActiveTab(nextTab);
    if (nextTab === "history") setSelectedHistoryId(null);
  }

  function showPredictionHistory() {
    setSelectedHistoryId(null);
    setActiveTab("history");
  }

  function handleRestoreHistory(restoration) {
    invalidatePendingAnalysis();
    restoreHistoryIntoPrediction(appPreferences, restoration);
    setError("");
    setSelectedHistoryId(null);
    setRestoredFitVersion((version) => version + 1);
    setActiveTab("new");
  }

  function invalidatePendingAnalysis() {
    analysisRequestIdRef.current += 1;
    setIsLoading(false);
  }

  return (
    <div className="prediction-studio-page">
      <section className="planning-studio-layout">
        <div className="satellite-workspace">
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
                  <PredictionAssetIcon src={heroLeafIcon} />
                </span>

                <h1>Farm Area Analyzer</h1>

                <p>
                  Select your farm details to analyze the area and get started.
                </p>
              </header>

              <PredictionPageTabs
                activeTab={activeTab}
                onTabChange={handleTabChange}
              />
            </section>

            <section
              aria-labelledby="prediction-tab-new"
              className="prediction-tab-panel prediction-new-analysis-panel"
              hidden={activeTab !== "new"}
              id="prediction-panel-new"
              role="tabpanel"
            >
              <SatellitePlanningMap
                clearVersion={clearVersion}
                district={selectedDistrict}
                districtGeoJson={sabahDistricts}
                fitBoundaryVersion={restoredFitVersion}
                isBlocked={isReservedForestBlocked}
                isVisible={activeTab === "new"}
                key={clearVersion}
                polygon={polygon}
                reservedForestGeoJson={reservedForestOverlay}
                ref={satelliteMapRef}
                onPolygonChange={handlePolygonChange}
              />

              <div className="prediction-new-analysis-controls">
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
              </div>

              <div className="prediction-report-stack">
                <PredictionInsightsPanel
                  error={error}
                  isLoading={isLoading}
                  result={displayedResult}
                />

                <EnvironmentDataPanel
                  isLoading={isLoading}
                  result={displayedResult}
                />

                <SaveAnalysisHistoryPanel
                  district={selectedDistrict}
                  onViewHistory={showPredictionHistory}
                  polygon={polygon}
                  result={analysisResult}
                  selectedCrop={selectedCrop}
                />
              </div>

              <div className="prediction-security-note">
                <PredictionAssetIcon src={securityShieldIcon} />

                <span>
                  The selected map image may be sent to Gemini for analysis and
                  is not stored by AGROW. Saved history includes your boundary,
                  farm settings, and analysis results.
                </span>
              </div>
            </section>

            <section
              aria-labelledby="prediction-tab-history"
              className="prediction-tab-panel prediction-history-tab-panel"
              hidden={activeTab !== "history"}
              id="prediction-panel-history"
              role="tabpanel"
            >
              {activeTab === "history" &&
                (selectedHistoryId ? (
                  <PredictionHistoryDetail
                    historyId={selectedHistoryId}
                    onBack={() => setSelectedHistoryId(null)}
                    onRestore={handleRestoreHistory}
                  />
                ) : (
                  <PredictionHistoryPanel
                    cropOptions={cropOptions}
                    districtOptions={districtChoices}
                    onRestore={handleRestoreHistory}
                    onSelectHistory={setSelectedHistoryId}
                    onStartNewAnalysis={() => setActiveTab("new")}
                  />
                ))}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function normalizeReservedForestOverlay(overlay) {
  if (!overlay) return null;

  if (typeof overlay === "string") {
    try {
      return JSON.parse(overlay);
    } catch {
      return null;
    }
  }

  if (overlay.type === "FeatureCollection") return overlay;

  return null;
}

function findCropName(cropNames, cropName) {
  const normalizedName = normalizeCropName(cropName);
  if (!normalizedName) return "";

  return (
    cropNames.find((name) => normalizeCropName(name) === normalizedName) || ""
  );
}

function normalizeCropName(value) {
  return String(value || "").trim().toLocaleLowerCase("en-MY");
}
