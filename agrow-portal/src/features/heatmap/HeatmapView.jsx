import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import sabahGeoJSON from '../../assets/maps/sabah-districts.json'
import {
  CARTO_BASEMAP_ATTRIBUTION,
  CARTO_BASEMAP_URL,
} from '../../config/cartoBasemap'
import {
  APP_PREFERENCE_KEYS,
  useAppPreference,
} from '../../context/appPreferences'
import {
  coordinateFromPosition,
  geolocationErrorMessage,
  requestCurrentPosition,
} from '../prediction/analysis/predictionGeolocation'
import {
  fetchPredictionCrops,
  predictCropSuitabilityBatch,
} from '../prediction/analysis/predictionApi'
import { findDistrictForPoint } from '../prediction/analysis/predictionUtils'
import 'leaflet/dist/leaflet.css'
import './heatmap-view.css'

const SABAH_BOUNDS = [[3.8, 114.3], [7.5, 119.5]]
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const DATABASE_API_URL = `${BASE_URL}/api/prediction`

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
  const [cropOptions, setCropOptions] = useState([])
  const [cropCatalogStatus, setCropCatalogStatus] = useState('loading')
  const [error, setError] = useState('')
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
  const [evaluationRevision, setEvaluationRevision] = useState(0)
  const cropNames = useMemo(
    () => cropOptions.map((crop) => crop.name),
    [cropOptions],
  )
  const isCropCatalogLoaded = cropCatalogStatus === 'ready'

  useEffect(() => {
    let isActive = true

    fetchPredictionCrops()
      .then((crops) => {
        if (!isActive) return
        setCropOptions(crops)
        setCropCatalogStatus('ready')
      })
      .catch((requestError) => {
        if (!isActive) return
        setCropOptions([])
        setCropCatalogStatus('error')
        setError(requestError.message || 'Unable to load the supported crop catalog.')
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!isCropCatalogLoaded) return

    const canonicalSelectedCrop = findCropName(cropNames, selectedCropOverride)
    if (selectedCropOverride && !canonicalSelectedCrop) {
      setSelectedCropOverride('')
    } else if (
      canonicalSelectedCrop &&
      canonicalSelectedCrop !== selectedCropOverride
    ) {
      setSelectedCropOverride(canonicalSelectedCrop)
    }

    if (
      displayedCropData?.crop &&
      !findCropName(cropNames, displayedCropData.crop)
    ) {
      setDisplayedCropData(null)
    }
  }, [
    cropNames,
    displayedCropData,
    isCropCatalogLoaded,
    selectedCropOverride,
    setDisplayedCropData,
    setSelectedCropOverride,
  ])

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
  const canonicalSelectedDistrict = useMemo(
    () => findCropName(districtList, selectedDistrict),
    [districtList, selectedDistrict],
  )

  useEffect(() => {
    if (!selectedDistrict) return

    if (!canonicalSelectedDistrict) {
      setSelectedDistrict('')
      setSelectedCropOverride('')
      setDisplayedCropData(null)
      return
    }

    if (canonicalSelectedDistrict !== selectedDistrict) {
      setSelectedDistrict(canonicalSelectedDistrict)
    }
  }, [
    canonicalSelectedDistrict,
    selectedDistrict,
    setDisplayedCropData,
    setSelectedCropOverride,
    setSelectedDistrict,
  ])

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict
  }, [selectedDistrict])

  useEffect(() => {
    fetch(`${DATABASE_API_URL}/live-matrix`)
      .then((res) => {
        if (!res.ok) throw new Error('Unable to load the ecosystem matrix.')
        return res.json()
      })
      .then(data => {
        if (data.status === 'success') {
          setDistrictMatrix(data.districts)
        } else if (data.message) {
          setError(data.message)
        }
      })
      .catch((requestError) => {
        setError(requestError.message || 'Unable to load the ecosystem matrix.')
        console.error('Error loading ecosystem matrix:', requestError)
      })
  }, [setDistrictMatrix])

  useEffect(() => {
    if (!selectedDistrict || !isCropCatalogLoaded) return undefined
    if (canonicalSelectedDistrict !== selectedDistrict) return undefined

    if (!cropNames.length) {
      setDisplayedCropData(null)
      return undefined
    }

    const selectedCrop = findCropName(cropNames, selectedCropOverride)
    if (selectedCropOverride && selectedCrop !== selectedCropOverride) {
      return undefined
    }

    const districtKey = Object.keys(districtMatrix).find(
      (key) => key.toLowerCase().trim() === selectedDistrict.toLowerCase().trim()
    )
    const metrics = districtKey ? districtMatrix[districtKey] : null

    if (!metrics) {
      console.warn(`No environmental metrics found matching district name: '${selectedDistrict}'`)
      return
    }

    let cancelled = false

    const runEvaluationPipeline = async () => {
      setIsLoading(true)
      setError('')
      const targetCrops = selectedCrop ? [selectedCrop] : cropNames

      try {
        const batch = await predictCropSuitabilityBatch({
          cropNames: targetCrops,
          district: selectedDistrict,
          latitude: metrics.lat,
          longitude: metrics.lng,
          elevation_meters: metrics.elev,
          slope_pct: metrics.slope,
          soil_ph: metrics.ph,
          soil_depth_cm: metrics.depth,
          annual_rainfall_mm: metrics.rain,
          solar_radiation: metrics.solar,
          root_zone_moisture: metrics.moisture,
        })
        if (cancelled) return

        const successfulPredictions = Array.isArray(batch?.predictions)
          ? batch.predictions.filter((prediction) =>
              Boolean(findCropName(targetCrops, prediction?.crop)),
            )
          : []

        if (successfulPredictions.length === 0) {
          setDisplayedCropData(null)
          setError(batchErrorMessage(batch?.errors))
          return
        }

        if (Array.isArray(batch?.errors) && batch.errors.length) {
          setError(batchErrorMessage(batch.errors))
        }

        if (selectedCrop) {
          setDisplayedCropData(
            successfulPredictions.find(
              (prediction) =>
                normalizeCropName(prediction?.crop) === normalizeCropName(selectedCrop),
            ) || successfulPredictions[0],
          )
          return
        }

        const rankWeight = { 'S1': 4, 'S2': 3, 'S3': 2, 'N': 1 }
        const bestCropMatch = successfulPredictions.reduce((best, current) => {
          const currentWeight = rankWeight[current.suitability] || 0
          const bestWeight = rankWeight[best.suitability] || 0

          if (currentWeight > bestWeight) return current
          if (currentWeight === bestWeight) {
            const currentPct = current.confidence_matrix?.[current.suitability] || 0
            const bestPct = best.confidence_matrix?.[best.suitability] || 0
            return currentPct > bestPct ? current : best
          }
          return best
        })

        setDisplayedCropData(bestCropMatch)
      } catch (err) {
        if (!cancelled) {
          setDisplayedCropData(null)
          setError(err.message || 'Crop recommendation computation failed.')
          console.error('Crop recommendation computation failed:', err)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    runEvaluationPipeline()
    return () => {
      cancelled = true
    }
  }, [
    districtMatrix,
    cropNames,
    canonicalSelectedDistrict,
    evaluationRevision,
    isCropCatalogLoaded,
    selectedCropOverride,
    selectedDistrict,
    setDisplayedCropData,
  ])

  const selectLocationDistrict = useCallback((district) => {
    const nextDistrict = String(district || '').trim()
    if (!nextDistrict) return

    setSelectedCropOverride('')
    setDisplayedCropData(null)
    setError('')
    setSelectedDistrict(nextDistrict)
    setEvaluationRevision(revision => revision + 1)
  }, [
    setDisplayedCropData,
    setSelectedCropOverride,
    setSelectedDistrict,
  ])

  const handleCropProfileChange = (event) => {
    setDisplayedCropData(null)
    setError('')
    setSelectedCropOverride(event.target.value)
    setEvaluationRevision(revision => revision + 1)
  }

  const handleUseCurrentLocation = async () => {
    try {
      const position = await requestCurrentPosition()
      const { latitude, longitude } = coordinateFromPosition(position)
      const district = findDistrictForPoint(
        [longitude, latitude],
        sabahGeoJSON?.features || [],
      )

      if (!district) {
        alert('Your current location is outside the supported Sabah districts.')
        return
      }

      selectLocationDistrict(district)
    } catch (error) {
      alert(geolocationErrorMessage(error))
    }
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
      click: () => selectLocationDistrict(name),
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
    const confidence = cropData.confidence_matrix?.[tier] || 0

    const insightsPool = {
      S1: `Exceptional match! The machine learning matrix confirms that this district provides prime environmental conditions for ${crop}. With an outstanding ${confidence}% alignment in this optimal classification, soil depth, pH, and irrigation baselines are excellently tailored for high-yield production.`,
      S2: `${crop} shows a solid, moderate suitability baseline here with a ${confidence}% class confidence match. While conditions are favorable overall, minor constraints like seasonal rainfall variations or slight soil adjustments might be required to unlock maximum capacity.`,
      S3: `Marginal compatibility detected. ${crop} is viable with a ${confidence}% rating, but faces notable ecological thresholds. Successful cultivation within this district will require targeted agricultural intervention or specialized soil treatments.`,
      N: `Cultivation not recommended. The prediction engine flags this district as environmentally unsuitable for ${crop} (${confidence}% class certainty). Local metrics like terrain slope or incompatible profiles present restrictive growth barriers.`
    }
    return insightsPool[tier] || `Ecosystem analysis complete. Location exhibits strong affinity toward Class ${tier} parameters.`
  }

  const cropProfileValue = selectedCropOverride

  return (
    <div className='heatmap-dashboard-view'>
      <div className='heatmap-grid-layout'>

        <div className='heatmap-left-panel'>
          <div className='card main-map-card'>
            <div className='map-controls-bar'>
              <div className='dropdown-groups-wrapper'>
                <div className='control-select-block'>
                  <label htmlFor='heatmap-district-select' className='mb-1 fw-medium text-secondary' style={{ display: 'block', fontSize: '0.75rem' }}>
                    District Details
                  </label>
                  <select
                    id='heatmap-district-select'
                    className='control-dropdown-select'
                    value={selectedDistrict}
                    onChange={(event) => selectLocationDistrict(event.target.value)}
                  >
                    <option value='' disabled>Select a district...</option>
                    {districtList.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {selectedDistrict && (
                  <div className='control-select-block animate-fade-in'>
                    <label htmlFor='heatmap-crop-select' className='mb-1 fw-medium text-secondary' style={{ display: 'block', fontSize: '0.75rem' }}>
                      Inspect Target Crop
                    </label>
                    <select
                      id='heatmap-crop-select'
                      className='control-dropdown-select'
                      value={cropProfileValue}
                      onChange={handleCropProfileChange}
                      disabled={
                        cropCatalogStatus !== 'ready' || cropOptions.length === 0
                      }
                    >
                      <option value=''>
                        {getCropProfilePlaceholder(
                          cropCatalogStatus,
                          cropOptions.length,
                        )}
                      </option>
                      {cropOptions.map((crop) => (
                        <option value={crop.name} key={crop.id || crop.name}>
                          {crop.name} Profile
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <button type='button' className='location-gps-btn' onClick={handleUseCurrentLocation}>
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
                <TileLayer
                  attribution={CARTO_BASEMAP_ATTRIBUTION}
                  maxZoom={20}
                  subdomains='abcd'
                  url={CARTO_BASEMAP_URL}
                />
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

            {error && !isLoading && (
              <div className='heatmap-inline-error' role='alert'>{error}</div>
            )}

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
                      {displayedCropData.confidence_matrix?.[displayedCropData.suitability] ?? 0}% Match
                    </span>
                  </div>
                </div>

                <div className='breakdown-section-wrapper'>
                  <h6 className='matrix-breakdown-title text-secondary mb-3'>Confidence Matrix Breakdown</h6>
                  <div className='crop-bars-stack d-flex' style={{ flexDirection: 'column', gap: '14px' }}>
                    {Object.entries(displayedCropData.confidence_matrix || {}).map(([key, percentage]) => {
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
                  {getEmptySidebarMessage({
                    cropCatalogStatus,
                    hasError: Boolean(error),
                    selectedDistrict,
                  })}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

function batchErrorMessage(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'No crop predictions were returned for this district.'
  }

  const messages = errors
    .map((error) => {
      if (typeof error === 'string') return error.trim()
      if (!error || typeof error !== 'object') return ''

      const cropName = String(error.crop || error.crop_name || '').trim()
      const detail = String(error.detail || error.error || error.message || '').trim()
      return [cropName, detail].filter(Boolean).join(': ')
    })
    .filter(Boolean)

  if (!messages.length) {
    return `${errors.length} crop predictions could not be generated.`
  }

  const visibleMessages = messages.slice(0, 3)
  const remainingCount = messages.length - visibleMessages.length
  const remainingMessage = remainingCount
    ? ` ${remainingCount} more crop prediction${remainingCount === 1 ? '' : 's'} failed.`
    : ''

  return `${visibleMessages.join(' ')}${remainingMessage}`
}

function getCropProfilePlaceholder(cropCatalogStatus, cropCount) {
  if (cropCatalogStatus === 'loading') return 'Loading crops...'
  if (cropCatalogStatus === 'error') return 'Crops unavailable'
  if (cropCount === 0) return 'No crops available'
  return 'AI Optimal Recommendation'
}

function getEmptySidebarMessage({
  cropCatalogStatus,
  hasError,
  selectedDistrict,
}) {
  if (!selectedDistrict) {
    return 'Select a district layer on the map to run the matrix comparison models.'
  }
  if (cropCatalogStatus === 'loading') {
    return 'The crop catalog is still loading.'
  }
  if (cropCatalogStatus === 'error') {
    return 'Crop recommendations are unavailable until the crop catalog can be loaded.'
  }
  if (hasError) {
    return 'No crop recommendation is currently available for this district.'
  }
  return 'No crop prediction was returned for this district.'
}

function findCropName(cropNames, cropName) {
  const normalizedName = normalizeCropName(cropName)
  if (!normalizedName) return ''
  return cropNames.find((name) => normalizeCropName(name) === normalizedName) || ''
}

function normalizeCropName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-MY')
}
