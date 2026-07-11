import { useEffect, useMemo, useState } from "react";
import heroLeafIcon from "../../assets/prediction/hero-leaf.svg?raw";
import securityShieldIcon from "../../assets/prediction/security-shield.svg?raw";
import kundasangImage from "../../assets/landing/kundasang.png";
import sabahDistricts from "../dashboard/sabahDistricts";
import CropPlanningPanel, {
  EnvironmentDataPanel,
} from "./CropPlanningPanel";
import PredictionAssetIcon from "./PredictionAssetIcon";
import PredictionInsightsPanel from "./PredictionInsightsPanel";
import SatellitePlanningMap from "./SatellitePlanningMap";
import {
  analyzeCropArea,
  fetchPredictionCrops,
  fetchPredictionEnvironment,
  validateForestReserveArea,
} from "./predictionApi";
import {
  calculatePolygonAreaHectares,
  detectDistrictFromPolygon,
  formatFarmerFacingText,
} from "./predictionUtils";
import "./prediction-view.css";

export default function PredictionViews() {
  const [polygon, setPolygon] = useState(null);
  const [selectedCrop, setSelectedCrop] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [cropOptions, setCropOptions] = useState([]);
  const [districtOptions, setDistrictOptions] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [forestReserveResult, setForestReserveResult] = useState(null);
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
  const reserveStatus = analysisResult || forestReserveResult;
  const isReservedForestBlocked = Boolean(
    reserveStatus?.allowed === false ||
      reserveStatus?.blocked_reason === "reserved_forest",
  );
  const canAnalyze = Boolean(
    selectedCrop &&
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
      } catch (err) {
        if (isMounted) {
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
  }, [polygon]);

  function handlePolygonChange(nextPolygon) {
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
    setForestReserveResult(null);
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
      setError(formatFarmerFacingText(err.message) || "Unable to analyze this farm area right now.");
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
            districtGeoJson={sabahDistricts}
            isBlocked={isReservedForestBlocked}
            key={clearVersion}
            polygon={polygon}
            reservedForestGeoJson={reservedForestOverlay}
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
                  <PredictionAssetIcon src={heroLeafIcon} />
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
                result={displayedResult}
              />

              <EnvironmentDataPanel
                isLoading={isLoading}
                result={displayedResult}
              />
            </div>
          </div>

          <div className="prediction-security-note">
            <PredictionAssetIcon src={securityShieldIcon} />

            <span>
              Your data is secure and used only for analysis purposes.
            </span>
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
