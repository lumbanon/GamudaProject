import { useState, useEffect, useRef, useCallback } from 'react'
import './dashboard-view.css'
import axios from 'axios'
import InteractiveMap from './InteractiveMap'
import AdvancedSimulator from './AdvancedSimulator'
import {
  APP_PREFERENCE_KEYS,
  useAppPreference,
} from '../../context/appPreferences'


const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const DATABASE_API_URL = `${BASE_URL}/api/prediction`
const MODEL_API_URL = `${BASE_URL}/api/predict`

export default function DashboardView() {
  const [, setDbCrops] = useState([])
  const [activeCrop, setActiveCrop] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardActiveCrop,
    '',
  )
  const [selectedDistrict, setSelectedDistrict] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardDistrict,
    '',
  )
  const [districtMatrix, setDistrictMatrix] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardDistrictMatrix,
    {},
  )
  const [predictions, setPredictions] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardPredictions,
    { banana: null, watermelon: null, cabbage: null, durian: null },
  )
  const [allDistrictsSuitability, setAllDistrictsSuitability] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardDistrictSuitability,
    {},
  )
  const [isLoading, setIsLoading] = useState(false)
  const [, setApiError] = useState('')
  const [showModeling, setShowModeling] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardShowModeling,
    false,
  )
  const districtMatrixRef = useRef(districtMatrix)
  const selectedDistrictRef = useRef(selectedDistrict)

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict
  }, [selectedDistrict])

  const [simulationParams, setSimulationParams] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardSimulationParameters,
    { elev: 0, slope: 0, ph: 6.5, depth: 0, rain: 0, solar: 0 },
  )

  const handleParamChange = (key, value) => {
    setSimulationParams((prev) => ({ ...prev, [key]: value }))
  }

  const resetParams = () => {
    const m = getMatrixDataForDistrict(selectedDistrict)
    if (m) {
      setSimulationParams({
        elev: m.elev ?? 0,
        slope: m.slope ?? 0,
        ph: m.ph ?? 6.5,
        depth: m.depth ?? 0,
        rain: m.rain ?? 0,
        solar: m.solar ?? 0
      })
    }
  }

  // 1. Unified District Name Extractor to prevent mismatches between click events and render styles
  const getDistrictName = (feature) => {
    const name = feature?.properties?.NAME_2 ||
      feature?.properties?.district ||
      feature?.properties?.DISTRICT ||
      feature?.properties?.name ||
      feature?.properties?.NAME_1
    if (!name && feature?.properties) {
      console.warn('GeoJSON feature properties missing expected keys. Found:', Object.keys(feature.properties))
    }

    return name
  }

  // 2. Fetch Initial Ecosystem Matrix Map Records
  useEffect(() => {
    const fetchMatrixData = async () => {
      try {
        const response = await fetch(`${DATABASE_API_URL}/live-matrix`)
        const data = await response.json()

        if (data.status === 'success') {
          setDistrictMatrix(data.districts)
          setDbCrops(data.crops)

        } else if (data.status === 'empty') {
          setApiError(data.message)
        }
      } catch (err) {
        setApiError('Failed to load real-time ecosystem matrix from server')
        console.error(err)
      }
    }
    fetchMatrixData()
  }, [setDistrictMatrix])

  // 3. Fetch ALL Districts across active crop layer
  useEffect(() => {
    const fetchAllDistrictSuitability = async () => {
      if (!activeCrop || Object.keys(districtMatrix).length === 0) return

      setIsLoading(true)
      setApiError('')

      try {
        const districtKeys = Object.keys(districtMatrix)

        const predictionPromises = districtKeys.map(async (districtName) => {
          const metrics = districtMatrix[districtName]
          const payload = {
            latitude: metrics.lat,
            longitude: metrics.lng,
            district: districtName,
            elevation_meters: metrics.elev,
            slope_pct: metrics.slope,
            soil_ph: metrics.ph,
            soil_depth_cm: metrics.depth,
            annual_rainfall_mm: metrics.rain,
            solar_radiation: metrics.solar,
            root_zone_moisture: metrics.moisture,
            crop_name: activeCrop
          }

          const res = await axios.post(`${MODEL_API_URL}/suitability`, payload)
          return { districtName, suitability: res.data.suitability }

        })

        const results = await Promise.all(predictionPromises)

        const suitabilityLookup = {}
        results.forEach(({ districtName, suitability }) => {
          suitabilityLookup[districtName.toLowerCase().trim()] = suitability
        })
        setAllDistrictsSuitability(suitabilityLookup)
      } catch (err) {
        setApiError('Failed to generate full crop suitability layers from ML Engine')
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchAllDistrictSuitability()
  }, [activeCrop, districtMatrix, setAllDistrictsSuitability])

  // 4. Robust Case-Insensitive District Lookup Styler Function
  const getMatrixDataForDistrict = useCallback((geoJsonName) => {
    if (!geoJsonName || !districtMatrix || Object.keys(districtMatrix).length === 0) return null

    if (districtMatrix[geoJsonName]) return districtMatrix[geoJsonName]

    const foundKey = Object.keys(districtMatrix).find(
      (key) => key.toLowerCase().trim() === geoJsonName.toLowerCase().trim()
    )

    return foundKey ? districtMatrix[foundKey] : null
  }, [districtMatrix])

  const getSuitabilityColor = (suitability) => {
    switch (suitability?.trim()?.toUpperCase()) {
      case 'S1': return '#2d5a27' 
      case 'S2': return '#98d468' 
      case 'S3': return '#ffc107' 
      case 'N': return '#dc3545' 
      default: return '#cbd5e1' 
    }
  }

  const getDistrictStyle = useCallback((feature) => {
    const districtName = getDistrictName(feature)

    if (!districtName) {
      return {
        fillColor: '#cbd5e1',
        weight: 1.5,
        opacity: 1,
        color: '#94a3b8',
        fillOpacity: 0.75
      }
    }

    const normalizedName = districtName.toLowerCase().trim()
    const isSelected = normalizedName === selectedDistrict.toLowerCase().trim()

    if (!activeCrop) {
    return {
      fillColor: '#f1f5f9', 
      weight: isSelected ? 3 : 1.5,
      opacity: 1,
      color: isSelected ? '#27ae60' : '#cbd5e1', 
      fillOpacity: 0.6
    }
  }

    let suitability = null

    if (isSelected && activeCrop) {
      const cropKey = activeCrop.toLowerCase().trim()
      if (predictions[cropKey]) {
        suitability = predictions[cropKey].suitability
      }
    }

    if (!suitability) {
      suitability = allDistrictsSuitability[normalizedName]
    }

    if (!suitability) {
      const metrics = getMatrixDataForDistrict(districtName)
      if (metrics && activeCrop) {
        if (metrics[activeCrop]) {
          suitability = metrics[activeCrop].suitability
        } else {
          const structuralCropKey = Object.keys(metrics).find(
            (k) => k.toLowerCase().trim() === activeCrop.toLowerCase().trim()
          )
          suitability = structuralCropKey ? metrics[structuralCropKey]?.suitability : null
        }
      }
    }

    const fillColor = getSuitabilityColor(suitability)

    return {
      fillColor: fillColor,
      weight: isSelected ? 3 : 1.5,
      opacity: 1,
      color: isSelected ? '#2e5226' : '#94a3b8',
      fillOpacity: isSelected ? 0.95 : 0.75
    }
  }, [getMatrixDataForDistrict, activeCrop, selectedDistrict, predictions, allDistrictsSuitability])

  const latestStyleRef = useRef(getDistrictStyle)
  const geoJsonRef = useRef(null)

  useEffect(() => {
    latestStyleRef.current = getDistrictStyle
  }, [getDistrictStyle])

  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.eachLayer((layer) => {
        if (layer.feature) {
          layer.setStyle(getDistrictStyle(layer.feature))
        }
      })
    }
  }, [getDistrictStyle, allDistrictsSuitability])

  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.eachLayer((layer) => {
        if (layer.feature) {
          layer.setStyle(getDistrictStyle(layer.feature))
        }
      })
    }
  }, [getDistrictStyle, predictions])

  const m = getMatrixDataForDistrict(selectedDistrict)

useEffect(() => {
  if (!selectedDistrict) return;

  // Move the metrics evaluation inside the asynchronous cycle block
  const getSuitabilityPrediction = async () => {
    const metrics = getMatrixDataForDistrict(selectedDistrict);
    
    // FIX: Moving these state updates inside the scoped execution flow removes synchronous cascading renders
    if (!metrics) {
      setPredictions({ banana: null, watermelon: null, cabbage: null, durian: null });
      setApiError(`No database found for selected district: '${selectedDistrict}'`);
      return;
    }

    setIsLoading(true);
    setApiError('');

    const payloadSource = showModeling ? simulationParams : {
      elev: metrics.elev,
      slope: metrics.slope,
      ph: metrics.ph,
      depth: metrics.depth,
      rain: metrics.rain,
      solar: metrics.solar
    };

    const basePayload = {
      latitude: metrics.lat,
      longitude: metrics.lng,
      district: selectedDistrict,
      elevation_meters: payloadSource.elev,
      slope_pct: payloadSource.slope,
      soil_ph: payloadSource.ph,
      soil_depth_cm: payloadSource.depth,
      annual_rainfall_mm: payloadSource.rain,
      solar_radiation: payloadSource.solar,
      root_zone_moisture: metrics.moisture,
    };

    try {
      const [bananaRes, watermelonRes, cabbageRes, durianRes] = await Promise.all([
        axios.post(`${MODEL_API_URL}/suitability`, { ...basePayload, crop_name: 'Banana' }),
        axios.post(`${MODEL_API_URL}/suitability`, { ...basePayload, crop_name: 'Watermelon' }),
        axios.post(`${MODEL_API_URL}/suitability`, { ...basePayload, crop_name: 'Cabbage' }),
        axios.post(`${MODEL_API_URL}/suitability`, { ...basePayload, crop_name: 'Durian' })
      ]);

      setPredictions({
        banana: bananaRes.data,
        watermelon: watermelonRes.data, 
        cabbage: cabbageRes.data, 
        durian: durianRes.data
      });
    } catch (err) {
      setPredictions({ banana: null, watermelon: null, cabbage: null, durian: null });
      setApiError(err.message || 'Network failure while calling ML engine');
    } finally {
      setIsLoading(false);
    }
  };

  // Debounce handler stays intact to throttle fast slider adjustments
  const delayDebounce = setTimeout(() => {
    getSuitabilityPrediction();
  }, 150);

  return () => clearTimeout(delayDebounce);
}, [selectedDistrict, getMatrixDataForDistrict, showModeling, simulationParams, setPredictions]);

  const getBadgeClass = (suitability) => {
    const badgeMap = { S1: 'bg-primary', S2: 'bg-secondary', S3: 'bg-warning', N: 'bg-danger' }
    return badgeMap[suitability?.trim()?.toUpperCase()] || 'bg-secondary'
  }

  const getSuitabilityDesc = (suitability) => {
    const descMap = { S1: 'Highly Suitable', S2: 'Moderate Suitability', S3: 'Low Suitability', N: 'Not Suitable' }
    return descMap[suitability?.trim()?.toUpperCase()] || 'Unknown Suitability'
  }

  const getConfidenceText = (prediction) => {
    if (prediction?.prediction_basis === 'agronomic_guardrail') {
      return 'Agronomic limit'
    }

    const confidence = prediction?.confidence_matrix?.[prediction?.suitability]
    return `${confidence ?? 0}% ML confidence`
  }

  const onEachDistrictPolygon = (feature, layer) => {
    const districtName = getDistrictName(feature)
    if (!districtName) return

    layer.on({
      click: () => {
        setSelectedDistrict(districtName)

        const liveMatrix = districtMatrixRef.current

        if (liveMatrix && Object.keys(liveMatrix).length > 0) {
          const cleanTargetName = districtName.toLowerCase().trim()
          const foundKey = Object.keys(liveMatrix).find(
            (key) => key.toLowerCase().trim() === cleanTargetName
          )

          const m = foundKey ? liveMatrix[foundKey] : null

          if (m) {
            console.log("Found fresh district data on click!", m)
            setSimulationParams({
              elev: m.elev ? parseInt(m.elev, 10) : 0,
              slope: m.slope ? parseInt(m.slope, 10) : 0,
              ph: m.ph ? parseFloat(m.ph) : 6.5,
              depth: m.depth ? parseInt(m.depth, 10) : 0,
              rain: m.rain ? parseInt(m.rain, 10) : 0,
              solar: m.solar ? parseInt(m.solar, 10) : 0
            })
          } else {
            console.warn(`No key match found in districtMatrix for: "${districtName}"`)
          }
        } else {
          console.warn("districtMatrix is still empty or loading from API")
        }
      },

      mouseover: (e) => {
        const currentSelected = selectedDistrictRef.current
        if (districtName.toLowerCase().trim() !== currentSelected.toLowerCase().trim()) {
          e.target.setStyle({ fillOpacity: 0.7, weight: 2.5, color: '#27ae60' })
        }
      },
      mouseout: (e) => {
        const currentSelected = selectedDistrictRef.current
        if (districtName.toLowerCase().trim() !== currentSelected.toLowerCase().trim()) {
          e.target.setStyle(latestStyleRef.current(feature))
        }
      }
    })
  }

  useEffect(() => {
    districtMatrixRef.current = districtMatrix
  }, [districtMatrix])

  return (
    <div>
      <div className='row mb-4 justify-content-between'>
        <div className='col-12'>
          <div className='card'>
            <div className='dashboard-overview-grid'>
              <div className='dashboard-overview-item'>
                <h2>District overview:</h2>
                <h2 className='text-primary'>{selectedDistrict || 'Select a region'}</h2>
              </div>

              <div className='dashboard-overview-item'>
                <div className='card'>
                  <p>Banana Suitability</p>
                  <small><i>Musa spp.</i></small>
                  {!selectedDistrict && !isLoading && (<div className='mt-4'><p>n/a</p></div>)}
                  {selectedDistrict && isLoading && (<div className='mt-4'><p>Loading...</p></div>)}
                  {selectedDistrict && !isLoading && predictions.banana && (
                    <div className='d-flex align-items-center justify-content-between mt-4'>
                      <span
                        className={`badge ${getBadgeClass(predictions.banana.suitability)}`}
                        data-tooltip={getSuitabilityDesc(predictions.banana.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {predictions.banana.suitability}
                      </span>
                      <span
                        className={`confidence-text badge ${getBadgeClass(predictions.banana.suitability)} `}
                        data-tooltip={getSuitabilityDesc(predictions.banana.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {getConfidenceText(predictions.banana)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className='dashboard-overview-item'>
                <div className='card'>
                  <p>Watermelon Suitability</p>
                  <small><i>Citrullus lanatus.</i></small>
                  {!selectedDistrict && !isLoading && (<div className='mt-4'><p>n/a</p></div>)}
                  {selectedDistrict && isLoading && (<div className='mt-4'><p>Loading...</p></div>)}
                  {selectedDistrict && !isLoading && predictions.watermelon && (
                    <div className='d-flex align-items-center justify-content-between mt-4'>
                      <span
                        className={`badge ${getBadgeClass(predictions.watermelon.suitability)}`}
                        data-tooltip={getSuitabilityDesc(predictions.watermelon.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {predictions.watermelon.suitability}
                      </span>
                      <span
                        className={`confidence-text badge ${getBadgeClass(predictions.watermelon.suitability)} `}
                        data-tooltip={getSuitabilityDesc(predictions.watermelon.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {getConfidenceText(predictions.watermelon)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className='dashboard-overview-item'>
                <div className='card'>
                  <p>Durian Suitability</p>
                  <small><i>Durio zibethinus.</i></small>
                  {!selectedDistrict && !isLoading && (<div className='mt-4'><p>n/a</p></div>)}
                  {selectedDistrict && isLoading && (<div className='mt-4'><p>Loading...</p></div>)}
                  {selectedDistrict && !isLoading && predictions.durian && (
                    <div className='d-flex align-items-center justify-content-between mt-4'>
                      <span
                        className={`badge ${getBadgeClass(predictions.durian.suitability)}`}
                        data-tooltip={getSuitabilityDesc(predictions.durian.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {predictions.durian.suitability}
                      </span>
                      <span
                        className={`confidence-text badge ${getBadgeClass(predictions.durian.suitability)} `}
                        data-tooltip={getSuitabilityDesc(predictions.durian.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {getConfidenceText(predictions.durian)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className='dashboard-overview-item'>
                <div className='card'>
                  <p>Cabbage Suitability</p>
                  <small><i>Brassica oleracea var. capitata.</i></small>
                  {!selectedDistrict && !isLoading && (<div className='mt-4'><p>n/a</p></div>)}
                  {selectedDistrict && isLoading && (<div className='mt-4'><p>Loading...</p></div>)}
                  {selectedDistrict && !isLoading && predictions.cabbage && (
                    <div className='d-flex align-items-center justify-content-between mt-4'>
                      <span
                        className={`badge ${getBadgeClass(predictions.cabbage.suitability)}`}
                        data-tooltip={getSuitabilityDesc(predictions.cabbage.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {predictions.cabbage.suitability}
                      </span>
                      <span
                        className={`confidence-text badge ${getBadgeClass(predictions.cabbage.suitability)} `}
                        data-tooltip={getSuitabilityDesc(predictions.cabbage.suitability)}
                        style={{ cursor: 'help', position: 'relative' }}
                      >
                        {getConfidenceText(predictions.cabbage)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      <div className='row'>
        <div className='col-7'>
          <InteractiveMap 
            activeCrop={activeCrop} 
            setActiveCrop={setActiveCrop}
            onEachDistrictPolygon={onEachDistrictPolygon} 
            getDistrictStyle={getDistrictStyle} 
          />
        </div>
        <div className='col-5'>
          <AdvancedSimulator
            selectedDistrict={selectedDistrict}
            showModeling={showModeling}
            setShowModeling={setShowModeling}
            simulationParams={simulationParams}
            handleParamChange={handleParamChange}
            resetParams={resetParams}
            matrixData={m}
          />
        </div>
      </div>
      
    </div>
  )
}
