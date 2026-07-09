import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import sabahGeoJSON from '../../assets/maps/sabah-districts.json'
import 'leaflet/dist/leaflet.css'
import './dashboard-view.css'
import axios from 'axios'

const SABAH_BOUNDS = [[3.8, 114.3], [7.5, 119.5]]
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

async function fetchUnifiedSuitability(basePayload, cropName) {
  const response = await axios.post(`${API_BASE_URL}/api/prediction/suitability`, {
    crop: cropName,
    district: basePayload.district || null,
    latitude: basePayload.latitude ?? null,
    longitude: basePayload.longitude ?? null,
    user_inputs: {
      elevation_m: basePayload.elevation_meters ?? null,
      slope_pct: basePayload.slope_pct ?? null,
      soil_ph: basePayload.soil_ph ?? null,
      soil_depth_cm: basePayload.soil_depth_cm ?? null,
      rainfall_mm: basePayload.annual_rainfall_mm ?? null,
      solar_radiation: basePayload.solar_radiation ?? null,
      root_zone_moisture: basePayload.root_zone_moisture ?? null,
    },
  })

  return toDashboardPrediction(response.data)
}

function toDashboardPrediction(result) {
  const score = Number(result?.suitability_score ?? result?.suitability?.score)
  const roundedScore = Number.isFinite(score) ? Math.round(score) : 0
  const suitability = scoreToSuitabilityClass(roundedScore)

  return {
    ...result,
    prediction_detail: result?.suitability,
    score: roundedScore,
    status: result?.suitability?.status || 'N/A',
    suitability,
    confidence_matrix: {
      [suitability]: roundedScore,
    },
  }
}

function scoreToSuitabilityClass(score) {
  if (score >= 80) return 'S1'
  if (score >= 60) return 'S2'
  if (score >= 40) return 'S3'
  return 'N'
}

function MapResizeTrigger() {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 200)
    return () => clearTimeout(timer)
  }, [map])
  return null
}

export default function DashboardView() {
  const [, setDbCrops] = useState([])
  const [activeCrop, setActiveCrop] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [districtMatrix, setDistrictMatrix] = useState({})
  const [predictions, setPredictions] = useState({ watermelon: null, cabbage: null, durian: null })
  const [allDistrictsSuitability, setAllDistrictsSuitability] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [, setApiError] = useState('')
  const [showModeling, setShowModeling] = useState(false)
  const districtMatrixRef = useRef(districtMatrix)

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict
  }, [selectedDistrict])

  const [simulationParams, setSimulationParams] = useState({
    elev: 0,
    slope: 0,
    ph: 6.5,
    depth: 0,
    rain: 0,
    solar: 0
  })

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
        const response = await fetch(`${API_BASE_URL}/api/prediction/live-matrix`)
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
  }, [])

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

          const prediction = await fetchUnifiedSuitability(payload, activeCrop)
          return { districtName, suitability: prediction.suitability }

        })

        const results = await Promise.all(predictionPromises)

        const suitabilityLookup = {}
        results.forEach(({ districtName, suitability }) => {
          suitabilityLookup[districtName.toLowerCase().trim()] = suitability
        })
        setAllDistrictsSuitability(suitabilityLookup)
      } catch (err) {
        setApiError('Failed to generate full crop suitability layers from the prediction service')
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchAllDistrictSuitability()
  }, [activeCrop, districtMatrix])

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
  const selectedDistrictRef = useRef(selectedDistrict)
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
  }, [getDistrictStyle])

  const m = getMatrixDataForDistrict(selectedDistrict)

  useEffect(() => {
    const getSuitabilityPrediction = async () => {
      if (!selectedDistrict) return

      const metrics = getMatrixDataForDistrict(selectedDistrict)
      if (!metrics) {
        setPredictions({ watermelon: null, cabbage: null, durian: null })
        setApiError(`No database found for selected district: '${selectedDistrict}'`)
        return
      }

      setIsLoading(true)
      setApiError('')

      const basePayload = {
        latitude: metrics.lat,
        longitude: metrics.lng,
        district: selectedDistrict,
        elevation_meters: metrics.elev,
        slope_pct: metrics.slope,
        soil_ph: metrics.ph,
        soil_depth_cm: metrics.depth,
        annual_rainfall_mm: metrics.rain,
        solar_radiation: metrics.solar,
        root_zone_moisture: metrics.moisture,
      }

      try {
        const [watermelonRes, cabbageRes, durianRes] = await Promise.all([
          fetchUnifiedSuitability(basePayload, 'Watermelon'),
          fetchUnifiedSuitability(basePayload, 'Cabbage'),
          fetchUnifiedSuitability(basePayload, 'Durian')
        ])

        setPredictions({
          watermelon: watermelonRes, cabbage: cabbageRes, durian: durianRes
        })
      } catch (err) {
        setPredictions({ watermelon: null, cabbage: null, durian: null })
        setApiError(err.message || 'Network failure while calling ML engine')
      } finally {
        setIsLoading(false)
      }
    }
    getSuitabilityPrediction()
  }, [selectedDistrict, getMatrixDataForDistrict])

  const getBadgeClass = (suitability) => {
    const badgeMap = { S1: 'bg-primary', S2: 'bg-secondary', S3: 'bg-warning', N: 'bg-danger' }
    return badgeMap[suitability?.trim()?.toUpperCase()] || 'bg-secondary'
  }

  const getSuitabilityDesc = (suitability) => {
    const descMap = { S1: 'Highly Suitable', S2: 'Moderate Suitability', S3: 'Low Suitability', N: 'Not Suitable' }
    return descMap[suitability?.trim()?.toUpperCase()] || 'Unknown Suitability'
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

  // console.log("Current activeCrop value:", activeCrop)

  return (
    <div>
      <div className='row mb-4 justify-content-between'>
        <div className='col-12'>
          <div className='card'>
            <div className='row align-items-center'>
              <div className='col-3'>
                <h2>District overview:</h2>
                <h2 className='text-primary'>{selectedDistrict || 'Select a region'}</h2>
              </div>

              <div className='col-3'>
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
                        {predictions.watermelon.confidence_matrix[predictions.watermelon.suitability]}% score
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className='col-3'>
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
                        {predictions.durian.confidence_matrix[predictions.durian.suitability]}% score
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className='col-3'>
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
                        {predictions.cabbage.confidence_matrix[predictions.cabbage.suitability]}% score
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
          <div className='card'>
            <div className="row">
              <div className="col-12">
                <p className='section-title'>Interactive Sabah Map</p>
              </div>
            </div>
            <div className='row'>
              <div className='col-4'>
                <div className='dropdown-container'>
                  <label htmlFor='crop-select' className='dropdown-label mt-2 mb-0'>
                    Target Crop Layer:
                  </label>
                  <select
                    id='crop-select'
                    value={activeCrop}
                    onChange={(e) => setActiveCrop(e.target.value)}
                    className='select-dropdown'
                  >
                    <option value='' disabled>Select a crop...</option>
                    <option value='Cabbage' >Cabbage</option>
                    <option value='Durian' >Durian</option>
                    <option value='Watermelon' >Watermelon</option>
                    {/* {dbCrops.map((crop) => (
                      <option key={crop} value={crop}>
                        {crop}
                      </option>
                    ))} */}
                  </select>
                </div>
              </div>
            </div>

            <div className='map-wrapper'>
              <MapContainer
                center={[5.85, 117.0]}
                zoom={8}
                minZoom={7}
                maxBounds={SABAH_BOUNDS}
                maxBoundsViscosity={1.0}
                className='map-instance'
              >
                <TileLayer url='https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' />

                <GeoJSON
                  ref={geoJsonRef}
                  key='sabah-district-layers'
                  data={sabahGeoJSON}
                  onEachFeature={onEachDistrictPolygon}
                  style={getDistrictStyle}
                />

                <MapResizeTrigger />
              </MapContainer>
            </div>

          </div>
        </div>

        <div className='col-5'>
          <div className='card'>
            <div className='sandbox-header-container'>
              <div className='d-flex justify-content-between align-items-center'>
                <h3 className='section-title m-0'>Advanced Simulator</h3>
                <div className='custom-toggle-container'>
                  <input
                    type='checkbox'
                    id='customParamToggle'
                    className='custom-toggle-input'
                    checked={showModeling}
                    onChange={(e) => setShowModeling(e.target.checked)}
                  />
                  <label htmlFor='customParamToggle' className='custom-toggle-label'>
                    <span className='custom-toggle-thumb'></span>
                  </label>
                </div>
              </div>
              <p className='section-description mt-2 mb-0'>
                Enable to manually simulate chemical soil adjustments, land-terracing, or local micro-climate offsets.
              </p>
            </div>

            {!showModeling && (
              <div className='automated-profile-section mt-4'>
                <h5 className='section-subtitle subtitle-automated'>AUTOMATED SITE PROFILE for {selectedDistrict || 'Selected Region'}</h5>
                <div className='profile-grid'>
                  <div className='profile-box'>
                    <span className='profile-label'>ELEVATION</span>
                    <span className='profile-value'>{m ? `${m.elev}m` : '—'}</span>
                  </div>
                  <div className='profile-box'>
                    <span className='profile-label'>TERRAIN SLOPE</span>
                    <span className='profile-value'>{m ? `${m.slope}%` : '—'}</span>
                  </div>
                  <div className='profile-box'>
                    <span className='profile-label'>SOIL ACIDITY</span>
                    <span className='profile-value'>{m ? `${m.ph} pH` : '—'}</span>
                  </div>
                  <div className='profile-box'>
                    <span className='profile-label'>SOIL DEPTH</span>
                    <span className='profile-value'>{m ? `${m.depth}cm` : '—'}</span>
                  </div>
                  <div className='profile-box'>
                    <span className='profile-label'>ANNUAL RAINFALL</span>
                    <span className='profile-value'>{m ? `${Number(m.rain).toLocaleString()}mm` : '—'}</span>
                  </div>
                  <div className='profile-box'>
                    <span className='profile-label'>SOLAR INTENSITY</span>
                    <span className='profile-value'>{m ? `${m.solar}` : '—'}</span>
                  </div>
                </div>
              </div>
            )}

            {showModeling && (
              <div className='interactive-modulators-section mt-4'>
                <h5 className='section-subtitle subtitle-interactive'>INTERACTIVE MODULATORS</h5>

                <div className='simulator-slider-group'>
                  <div className='slider-header'>
                    <span className='slider-title'>Elevation Baseline:</span>
                    <span className='slider-current-value'>{simulationParams.elev}m</span>
                  </div>
                  <input
                    type='range'
                    min='0'
                    max='3000'
                    step='10'
                    value={simulationParams.elev}
                    onChange={(e) => handleParamChange('elev', parseInt(e.target.value))}
                    className='sandbox-range-input'
                  />
                </div>

                <div className='simulator-slider-group'>
                  <div className='slider-header'>
                    <span className='slider-title'>Slope Angle:</span>
                    <span className='slider-current-value'>{simulationParams.slope}%</span>
                  </div>
                  <input
                    type='range'
                    min='0'
                    max='100'
                    step='1'
                    value={simulationParams.slope}
                    onChange={(e) => handleParamChange('slope', parseInt(e.target.value))}
                    className='sandbox-range-input'
                  />
                </div>

                <div className='simulator-slider-group'>
                  <div className='slider-header'>
                    <span className='slider-title'>Soil Chemistry (pH):</span>
                    <span className='slider-current-value'>{simulationParams.ph} pH</span>
                  </div>
                  <input
                    type='range'
                    min='3.5'
                    max='9.0'
                    step='0.1'
                    value={simulationParams.ph}
                    onChange={(e) => handleParamChange('ph', parseFloat(e.target.value))}
                    className='sandbox-range-input'
                  />
                </div>

                <div className='simulator-slider-group'>
                  <div className='slider-header'>
                    <span className='slider-title'>Soil Depth:</span>
                    <span className='slider-current-value'>{simulationParams.depth} cm</span>
                  </div>
                  <input
                    type='range'
                    min='0'
                    max='200'
                    step='5'
                    value={simulationParams.depth}
                    onChange={(e) => handleParamChange('depth', parseInt(e.target.value))}
                    className='sandbox-range-input'
                  />
                </div>

                <div className='simulator-slider-group'>
                  <div className='slider-header'>
                    <span className='slider-title'>Annual Rainfall:</span>
                    <span className='slider-current-value'>{Number(simulationParams.rain).toLocaleString()} mm</span>
                  </div>
                  <input
                    type='range'
                    min='500'
                    max='5000'
                    step='50'
                    value={simulationParams.rain}
                    onChange={(e) => handleParamChange('rain', parseInt(e.target.value))}
                    className='sandbox-range-input'
                  />
                </div>

                <div className='simulator-slider-group'>
                  <div className='slider-header'>
                    <span className='slider-title'>Solar Intensity:</span>
                    <span className='slider-current-value'>{simulationParams.solar}</span>
                  </div>
                  <input
                    type='range'
                    min='0'
                    max='50'
                    step='1'
                    value={simulationParams.solar}
                    onChange={(e) => handleParamChange('solar', parseInt(e.target.value))}
                    className='sandbox-range-input'
                  />
                </div>

                <div className='modeling-actions mt-4 d-flex gap-2'>
                  <button onClick={resetParams} className='btn-reset-simulation'>
                    {m ? '[ Reset to Baseline ]' : '[ Reset ]'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
