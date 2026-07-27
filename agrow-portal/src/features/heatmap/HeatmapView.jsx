import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import sabahGeoJSON from '../../assets/maps/sabah-districts.json'
import {
  APP_PREFERENCE_KEYS,
  useAppPreference,
} from '../../context/appPreferences'
import 'leaflet/dist/leaflet.css'
import './heatmap-view.css'

const SABAH_BOUNDS = [[3.8, 114.3], [7.5, 119.5]]
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const API_BASE_URL = `${BASE_URL}/api/predict`

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

export default function HeatmapView() {
  const [selectedDistrict, setSelectedDistrict] = useAppPreference(
    APP_PREFERENCE_KEYS.heatmapDistrict,
    '',
  )
  const [selectedCropOverride, setSelectedCropOverride] = useAppPreference(
    APP_PREFERENCE_KEYS.heatmapCrop,
    '',
  )
  const geoJsonRef = useRef(null)
  const selectedDistrictRef = useRef(selectedDistrict)

  const [districtMatrix, setDistrictMatrix] = useAppPreference(
    APP_PREFERENCE_KEYS.heatmapDistrictMatrix,
    {},
  )
  const [displayedCropData, setDisplayedCropData] = useAppPreference(
    APP_PREFERENCE_KEYS.heatmapDisplayedCrop,
    null,
  )
  const [isLoading, setIsLoading] = useState(false)

  const getDistrictName = (feature) => {
    return feature?.properties?.NAME_2 ||
      feature?.properties?.district ||
      feature?.properties?.DISTRICT ||
      feature?.properties?.name ||
      feature?.properties?.NAME_1 || ''
  }

  const districtList = useMemo(() => {
    if (!sabahGeoJSON?.features) return []
    const names = sabahGeoJSON.features.map(f => getDistrictName(f)).filter(Boolean)
    return [...new Set(names)].sort()
  }, [])

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict
  }, [selectedDistrict])

  useEffect(() => {
    fetch(`${API_BASE_URL}/live-matrix`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setDistrictMatrix(data.districts)
        }
      })
      .catch(err => console.error('Error loading ecosystem matrix:', err))
  }, [setDistrictMatrix])

  // useEffect(() => {
  //   setSelectedCropOverride('')
  // }, [selectedDistrict])

  useEffect(() => {
    if (!selectedDistrict) return

    const districtKey = Object.keys(districtMatrix).find(
      (key) => key.toLowerCase().trim() === selectedDistrict.toLowerCase().trim()
    )
    const metrics = districtKey ? districtMatrix[districtKey] : null

    if (!metrics) {
      console.warn(`No environmental metrics found matching district name: '${selectedDistrict}'`)
      return
    }

    const runEvaluationPipeline = async () => {
      setIsLoading(true)
      const targetCrops = selectedCropOverride ? [selectedCropOverride] : ['Banana', 'Durian', 'Watermelon', 'Cabbage']

      const predictionPromises = targetCrops.map(crop => {
        const payload = {
          crop_name: crop,
          district: selectedDistrict,
          latitude: metrics.lat,
          longitude: metrics.lng,
          elevation_meters: metrics.elev,
          slope_pct: metrics.slope,
          soil_ph: metrics.ph,
          soil_depth_cm: metrics.depth,
          annual_rainfall_mm: metrics.rain,
          solar_radiation: metrics.solar,
          root_zone_moisture: metrics.moisture
        }

        return fetch(`${API_BASE_URL}/suitability`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(res => res.json())
      })

      try {
        const results = await Promise.all(predictionPromises)
        const successfulPredictions = results.filter(r => r.status === 'success')

        if (successfulPredictions.length === 0) {
          setDisplayedCropData(null)
          return
        }

        if (selectedCropOverride) {
          setDisplayedCropData(successfulPredictions[0])
          return
        }

        const rankWeight = { 'S1': 4, 'S2': 3, 'S3': 2, 'N': 1 }
        const bestCropMatch = successfulPredictions.reduce((best, current) => {
          const currentWeight = rankWeight[current.suitability] || 0
          const bestWeight = rankWeight[best.suitability] || 0

          if (currentWeight > bestWeight) return current
          if (currentWeight === bestWeight) {
            const currentPct = current.confidence_matrix[current.suitability] || 0
            const bestPct = best.confidence_matrix[best.suitability] || 0
            return currentPct > bestPct ? current : best
          }
          return best
        })

        setDisplayedCropData(bestCropMatch)
      } catch (err) {
        console.error('Crop recommendation computation failed:', err)
      } finally {
        setIsLoading(false)
      }
    }

    runEvaluationPipeline()
  }, [
    districtMatrix,
    selectedCropOverride,
    selectedDistrict,
    setDisplayedCropData,
  ])

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser')
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => setSelectedDistrict('Kota Kinabalu'),
      () => alert('Unable to retrieve your location')
    )
  }

  const heatmapStyle = useCallback((feature) => {
    const name = getDistrictName(feature)
    const isSelected = name.toLowerCase().trim() === selectedDistrict.toLowerCase().trim()

    return {
      fillColor: isSelected ? '#1e3a8a' : '#cbd5e1',
      weight: isSelected ? 2.5 : 1.5,
      opacity: 1,
      color: isSelected ? '#1e293b' : '#94a3b8',
      fillOpacity: isSelected ? 0.85 : 0.6
    }
  }, [selectedDistrict])

  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.eachLayer((layer) => {
        if (layer.feature) {
          layer.setStyle(heatmapStyle(layer.feature))
        }
      })
    }
  }, [selectedDistrict, heatmapStyle])

  const onEachDistrictPolygon = (feature, layer) => {
    const name = getDistrictName(feature)
    if (!name) return

    layer.on({
      click: () => setSelectedDistrict(name),
      mouseover: (e) => {
        e.target.setStyle({ fillOpacity: 0.8, weight: 2 })
      },
      mouseout: () => {
        const isCurrentlySelected = name.toLowerCase().trim() === selectedDistrictRef.current.toLowerCase().trim()

        layer.setStyle({
          fillColor: isCurrentlySelected ? '#1e3a8a' : '#cbd5e1',
          weight: isCurrentlySelected ? 2.5 : 1.5,
          opacity: 1,
          color: isCurrentlySelected ? '#1e293b' : '#94a3b8',
          fillOpacity: isCurrentlySelected ? 0.85 : 0.6
        })
      }
    })
  }

  const tierLabels = {
    'S1': 'S1 (Highly Suitable)',
    'S2': 'S2 (Moderately Suitable)',
    'S3': 'S3 (Marginally Suitable)',
    'N': 'N (Not Suitable)'
  }

  const generateCropSummary = (cropData) => {
    if (!cropData) return ""
    const crop = cropData.crop
    const tier = cropData.suitability
    const confidence = cropData.confidence_matrix[tier] || 0

    const insightsPool = {
      S1: `Exceptional match! The machine learning matrix confirms that this district provides prime environmental conditions for ${crop}. With an outstanding ${confidence}% alignment in this optimal classification, soil depth, pH, and irrigation baselines are excellently tailored for high-yield production.`,
      S2: `${crop} shows a solid, moderate suitability baseline here with a ${confidence}% class confidence match. While conditions are favorable overall, minor constraints like seasonal rainfall variations or slight soil adjustments might be required to unlock maximum capacity.`,
      S3: `Marginal compatibility detected. ${crop} is viable with a ${confidence}% rating, but faces notable ecological thresholds. Successful cultivation within this district will require targeted agricultural intervention or specialized soil treatments.`,
      N: `Cultivation not recommended. The prediction engine flags this district as environmentally unsuitable for ${crop} (${confidence}% class certainty). Local metrics like terrain slope or incompatible profiles present restrictive growth barriers.`
    }
    return insightsPool[tier] || `Ecosystem analysis complete. Location exhibits strong affinity toward Class ${tier} parameters.`
  }

  return (
    <div className='heatmap-dashboard-view'>
      <div className='heatmap-grid-layout'>

        <div className='heatmap-left-panel'>
          <div className='card main-map-card'>
            <div className='map-controls-bar'>
              <div className='dropdown-groups-wrapper'>
                <div className='control-select-block'>
                  <span className='mb-1 fw-medium text-secondary' style={{ display: 'block', fontSize: '0.75rem' }}>
                    District Details
                  </span>
                  <select
                    className='control-dropdown-select'
                    value={selectedDistrict}
                    onChange={(e) => {
                      setSelectedDistrict(e.target.value);
                      setSelectedCropOverride(''); // ✅ Reset target crop immediately during the user event
                    }}
                  >
                    <option value='' disabled>Select a district...</option>
                    {districtList.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {selectedDistrict && (
                  <div className='control-select-block animate-fade-in'>
                    <span className='mb-1 fw-medium text-secondary' style={{ display: 'block', fontSize: '0.75rem' }}>
                      Inspect Target Crop
                    </span>
                    <select
                      className='control-dropdown-select'
                      value={selectedCropOverride}
                      onChange={(e) => setSelectedCropOverride(e.target.value)}
                    >
                      <option value=''>AI Optimal Recommendation</option>
                      <option value='Banana'>Banana Profile</option>
                      <option value='Durian'>Durian Profile</option>
                      <option value='Watermelon'>Watermelon Profile</option>
                      <option value='Cabbage'>Cabbage Profile</option>
                    </select>
                  </div>
                )}
              </div>

              <button className='location-gps-btn' onClick={handleUseCurrentLocation}>
                <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='currentColor' viewBox='0 0 16 16' style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                  <path d='M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z' />
                </svg>
                USE MY CURRENT LOCATION
              </button>
            </div>

            <div className='heatmap-map-wrapper'>
              <MapContainer
                center={[5.85, 117.0]}
                zoom={8}
                minZoom={7}
                maxBounds={SABAH_BOUNDS}
                maxBoundsViscosity={1.0}
                className='heatmap-instance'
              >
                <TileLayer url='https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' />
                <GeoJSON
                  ref={geoJsonRef}
                  key='sabah-heatmap-layers'
                  data={sabahGeoJSON}
                  style={heatmapStyle}
                  onEachFeature={onEachDistrictPolygon}
                />
                <MapResizeTrigger />
              </MapContainer>
            </div>
          </div>
        </div>

        <div className='heatmap-right-panel'>
          <div className='card prediction-sidebar-card'>
            <h6 className='prediction-card-title text-muted'>
              {selectedCropOverride ? 'Target Crop Analysis' : 'Best Recommended Crop'}
            </h6>

            {isLoading ? (
              <div className='sidebar-loader-wrapper text-center'>
                <div className='spinner-element'></div>
                <p className='text-muted fw-medium' style={{ fontSize: '0.8rem', marginTop: '12px' }}>
                  Evaluating ecosystem datasets...
                </p>
              </div>
            ) : displayedCropData ? (
              <div className='sidebar-content-animator animate-fade-in'>

                <div className='recommendation-hero-box'>
                  <span className='hero-badge'>{selectedCropOverride ? 'Manual Inspection' : 'Top Performer'}</span>
                  <h2 className='display-crop-name' style={{ color: '#ffffff', margin: '8px 0 16px 0' }}>
                    {displayedCropData.crop}
                  </h2>
                  <div className='hero-footer-row d-flex justify-content-between align-items-center'>
                    <span className='suitability-pill fw-bold'>Class {displayedCropData.suitability}</span>
                    <span className='match-percentage fw-medium text-white-50'>
                      {displayedCropData.confidence_matrix[displayedCropData.suitability]}% Match
                    </span>
                  </div>
                </div>

                <div className='breakdown-section-wrapper'>
                  <h6 className='matrix-breakdown-title text-secondary mb-3'>Confidence Matrix Breakdown</h6>
                  <div className='crop-bars-stack d-flex' style={{ flexDirection: 'column', gap: '14px' }}>
                    {Object.entries(displayedCropData.confidence_matrix).map(([key, percentage]) => {
                      const isMatch = displayedCropData.suitability === key
                      const barColors = { S1: '#10b981', S2: '#60a5fa', S3: '#fbbf24', N: '#f87171' }

                      return (
                        <div className='crop-progress-item' key={key}>
                          <div className='crop-progress-row d-flex justify-content-between mb-1' style={{ fontSize: '0.8rem' }}>
                            <span className={isMatch ? 'text-dark fw-bold' : 'text-secondary fw-medium'}>
                              {tierLabels[key] || key}
                            </span>
                            <span className={isMatch ? 'text-primary fw-bold' : 'text-dark fw-semibold'}>
                              {percentage}%
                            </span>
                          </div>

                          <div className='progress custom-bar-wrapper'>
                            <div
                              className='progress-bar custom-bar-fill'
                              style={{
                                width: `${percentage}%`,
                                backgroundColor: isMatch ? barColors[key] : '#cbd5e1',
                                height: '100%'
                              }}
                            ></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className='crop-insight-summary-card mt-auto'>
                  <div className='insight-header d-flex align-items-center mb-2' style={{ gap: '6px' }}>
                    <span className='insight-icon'>💡</span>
                    <h6 className='insight-title text-dark fw-bold' style={{ textTransform: 'none', letterSpacing: 'normal' }}>
                      Agrow-Ecosystem Insight
                    </h6>
                  </div>
                  <p className='insight-text text-muted' style={{ fontSize: '0.8rem', fontWeight: '500', lineHeight: '1.5' }}>
                    {generateCropSummary(displayedCropData)}
                  </p>
                </div>

              </div>
            ) : (
              <div className='sidebar-empty-wrapper text-center d-flex align-items-center justify-content-center'>
                <p className='text-muted' style={{ fontSize: '0.8rem', lineHeight: '1.4', padding: '0 16px' }}>
                  Select a district layer on the map to run the matrix comparison models.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
