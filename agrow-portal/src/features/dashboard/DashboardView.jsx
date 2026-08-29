import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './dashboard-view.css'
import InteractiveMap from './InteractiveMap'
import AdvancedSimulator from './AdvancedSimulator'
import {
  fetchPredictionCrops,
  predictCropSuitabilityBatch,
} from '../prediction/analysis/predictionApi'
import {
  APP_PREFERENCE_KEYS,
  useAppPreference,
} from '../../context/appPreferences'


const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const DATABASE_API_URL = `${BASE_URL}/api/prediction`
const EMPTY_PREDICTIONS = {}

export default function DashboardView() {
  const [cropOptions, setCropOptions] = useState([])
  const [cropCatalogStatus, setCropCatalogStatus] = useState('loading')
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
    EMPTY_PREDICTIONS,
  )
  const [allDistrictsSuitability, setAllDistrictsSuitability] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardDistrictSuitability,
    {},
  )
  const [isLoadingPredictions, setIsLoadingPredictions] = useState(false)
  const [loadedPredictionKey, setLoadedPredictionKey] = useState('')
  const [loadedLayerCrop, setLoadedLayerCrop] = useState('')
  const [apiError, setApiError] = useState('')
  const [layerError, setLayerError] = useState('')
  const [showModeling, setShowModeling] = useAppPreference(
    APP_PREFERENCE_KEYS.dashboardShowModeling,
    false,
  )
  const districtMatrixRef = useRef(districtMatrix)
  const selectedDistrictRef = useRef(selectedDistrict)
  const cropNames = useMemo(
    () => cropOptions.map((crop) => crop.name),
    [cropOptions],
  )
  const isCropCatalogLoaded = cropCatalogStatus === 'ready'
  const hasVerifiedActiveCrop = Boolean(
    isCropCatalogLoaded &&
      activeCrop &&
      findCropName(cropNames, activeCrop) === activeCrop,
  )

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict
  }, [selectedDistrict])

  useEffect(() => {
    let isActive = true

    fetchPredictionCrops()
      .then((crops) => {
        if (!isActive) return
        setCropOptions(crops)
        setCropCatalogStatus('ready')
      })
      .catch((error) => {
        if (!isActive) return
        setCropOptions([])
        setCropCatalogStatus('error')
        setApiError(error.message || 'Unable to load the supported crop catalog')
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!isCropCatalogLoaded || !activeCrop) return

    const canonicalCrop = findCropName(cropNames, activeCrop)
    if (!canonicalCrop) {
      setActiveCrop('')
      setAllDistrictsSuitability({})
      return
    }

    if (canonicalCrop !== activeCrop) setActiveCrop(canonicalCrop)
  }, [
    activeCrop,
    cropNames,
    isCropCatalogLoaded,
    setActiveCrop,
    setAllDistrictsSuitability,
  ])

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
        if (!response.ok) {
          throw new Error('Unable to load the Dashboard ecosystem matrix')
        }
        const data = await response.json()

        if (data.status === 'success') {
          setDistrictMatrix(data.districts)

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
    let cancelled = false

    const fetchAllDistrictSuitability = async () => {
      const canonicalCrop = findCropName(cropNames, activeCrop)
      if (
        !canonicalCrop ||
        canonicalCrop !== activeCrop ||
        Object.keys(districtMatrix).length === 0
      ) {
        setAllDistrictsSuitability({})
        setLoadedLayerCrop('')
        setLayerError('')
        return
      }

      setAllDistrictsSuitability({})
      setLoadedLayerCrop('')
      setLayerError('')

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
          }

          const batch = await predictCropSuitabilityBatch({
            ...payload,
            cropNames: [activeCrop],
          })
          const prediction = findBatchPrediction(batch, activeCrop)
          if (!prediction) {
            throw new Error(`No ${activeCrop} prediction was returned for ${districtName}`)
          }
          return { districtName, suitability: prediction.suitability }

        })

        const settledResults = await Promise.allSettled(predictionPromises)
        if (cancelled) return

        const suitabilityLookup = {}
        settledResults.forEach((result) => {
          if (result.status !== 'fulfilled') return
          const { districtName, suitability } = result.value
          suitabilityLookup[districtName.toLowerCase().trim()] = suitability
        })
        setAllDistrictsSuitability(suitabilityLookup)
        setLoadedLayerCrop(activeCrop)
        const rejectedCount = settledResults.filter(
          (result) => result.status === 'rejected',
        ).length
        if (rejectedCount === settledResults.length) {
          setLayerError('District suitability values could not be generated')
        } else if (rejectedCount) {
          setLayerError(
            `${rejectedCount} district suitability value${rejectedCount === 1 ? '' : 's'} could not be generated`,
          )
        }
      } catch (err) {
        if (!cancelled) {
          setLayerError('Failed to generate full crop suitability layers from ML Engine')
          console.error(err)
        }
      }
    }
    fetchAllDistrictSuitability()

    return () => {
      cancelled = true
    }
  }, [activeCrop, cropNames, districtMatrix, setAllDistrictsSuitability])

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

    if (!hasVerifiedActiveCrop) {
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
      suitability = findPredictionByCrop(predictions, activeCrop)?.suitability || null
    }

    if (!suitability && loadedLayerCrop === activeCrop) {
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
  }, [
    activeCrop,
    allDistrictsSuitability,
    getMatrixDataForDistrict,
    hasVerifiedActiveCrop,
    loadedLayerCrop,
    predictions,
    selectedDistrict,
  ])

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
  const predictionRequestKey = selectedDistrict && isCropCatalogLoaded
    ? JSON.stringify({
        cropNames,
        district: selectedDistrict,
        environment: showModeling
          ? simulationParams
          : {
              elev: m?.elev,
              slope: m?.slope,
              ph: m?.ph,
              depth: m?.depth,
              rain: m?.rain,
              solar: m?.solar,
              moisture: m?.moisture,
            },
        showModeling,
      })
    : ''

  useEffect(() => {
    if (!selectedDistrict || !isCropCatalogLoaded) return undefined

    if (!cropNames.length) {
      setPredictions(EMPTY_PREDICTIONS)
      return undefined
    }

    let cancelled = false

    const getSuitabilityPrediction = async () => {
      const metrics = getMatrixDataForDistrict(selectedDistrict)

      if (!metrics) {
        setPredictions(EMPTY_PREDICTIONS)
        setLoadedPredictionKey(predictionRequestKey)
        setApiError(`No database found for selected district: '${selectedDistrict}'`)
        setIsLoadingPredictions(false)
        return
      }

      setIsLoadingPredictions(true)
      setApiError('')

      const payloadSource = showModeling ? simulationParams : {
        elev: metrics.elev,
        slope: metrics.slope,
        ph: metrics.ph,
        depth: metrics.depth,
        rain: metrics.rain,
        solar: metrics.solar,
      }

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
      }

      try {
        const batch = await predictCropSuitabilityBatch({
          ...basePayload,
          cropNames,
        })
        if (cancelled) return

        setPredictions(buildPredictionMap(batch?.predictions, cropNames))
        setLoadedPredictionKey(predictionRequestKey)
        if (Array.isArray(batch?.errors) && batch.errors.length) {
          setApiError(`${batch.errors.length} crop predictions could not be generated`)
        }
      } catch (err) {
        if (cancelled) return
        setPredictions(EMPTY_PREDICTIONS)
        setLoadedPredictionKey(predictionRequestKey)
        setApiError(err.message || 'Network failure while calling ML engine')
      } finally {
        if (!cancelled) setIsLoadingPredictions(false)
      }
    }

    const delayDebounce = setTimeout(getSuitabilityPrediction, 150)

    return () => {
      cancelled = true
      clearTimeout(delayDebounce)
    }
  }, [
    cropNames,
    getMatrixDataForDistrict,
    isCropCatalogLoaded,
    predictionRequestKey,
    selectedDistrict,
    setPredictions,
    showModeling,
    simulationParams,
  ])

  const showPredictionLoading = Boolean(
    selectedDistrict &&
      isCropCatalogLoaded &&
      cropNames.length &&
      (isLoadingPredictions || loadedPredictionKey !== predictionRequestKey),
  )
  const dashboardError = [apiError, layerError].filter(Boolean).join(' ')

  const getBadgeClass = (suitability) => {
    const badgeMap = { S1: 'bg-primary', S2: 'bg-secondary', S3: 'bg-warning', N: 'bg-danger' }
    return badgeMap[suitability?.trim()?.toUpperCase()] || 'bg-secondary'
  }

  const getSuitabilityDesc = (suitability) => {
    const descMap = { S1: 'Highly Suitable', S2: 'Moderate Suitability', S3: 'Low Suitability', N: 'Not Suitable' }
    return descMap[suitability?.trim()?.toUpperCase()] || 'Unknown Suitability'
  }

  const getConfidenceText = (prediction) => {
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
          <div className='card dashboard-overview-card'>
            {dashboardError && (
              <div className='dashboard-inline-error' role='status' aria-live='polite'>
                {dashboardError}
              </div>
            )}
            <div className='dashboard-overview-grid'>
              <div className='dashboard-overview-item dashboard-district-overview'>
                <h2>District overview:</h2>
                <h2 className='text-primary'>{selectedDistrict || 'Select a region'}</h2>
              </div>

              <div
                className='dashboard-crop-card-scroll'
                role='region'
                aria-label='Crop suitability cards'
                aria-busy={showPredictionLoading}
                tabIndex={0}
              >
                <div className='dashboard-crop-card-grid'>
                  {cropOptions.map((crop) => {
                    const prediction = findPredictionByCrop(predictions, crop.name)
                    const scientificName = String(crop.scientific_name || '').trim()

                    return (
                      <div className='dashboard-overview-item' key={crop.id || crop.name}>
                        <div className='card'>
                          <p>{crop.name} Suitability</p>
                          <small>
                            {scientificName
                              ? <i>{scientificName}</i>
                              : 'Scientific name unavailable'}
                          </small>
                          {!selectedDistrict && (
                            <div className='mt-4'><p>n/a</p></div>
                          )}
                          {selectedDistrict && showPredictionLoading && (
                            <div className='mt-4'><p>Loading...</p></div>
                          )}
                          {selectedDistrict && !showPredictionLoading && !prediction && (
                            <div className='mt-4'><p>Unavailable</p></div>
                          )}
                          {selectedDistrict && !showPredictionLoading && prediction && (
                            <div className='d-flex align-items-center justify-content-between mt-4'>
                              <span
                                className={`badge ${getBadgeClass(prediction.suitability)}`}
                                data-tooltip={getSuitabilityDesc(prediction.suitability)}
                                style={{ cursor: 'help', position: 'relative' }}
                              >
                                {prediction.suitability}
                              </span>
                              <span
                                className={`confidence-text badge ${getBadgeClass(prediction.suitability)} `}
                                data-tooltip={getSuitabilityDesc(prediction.suitability)}
                                style={{ cursor: 'help', position: 'relative' }}
                              >
                                {getConfidenceText(prediction)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {cropCatalogStatus !== 'loading' && cropOptions.length === 0 && (
                    <div className='dashboard-crop-empty'>
                      {cropCatalogStatus === 'error'
                        ? 'The prediction crop catalog is unavailable.'
                        : 'No crops are currently available for prediction.'}
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
            cropOptions={cropOptions}
            hasCropCatalogError={cropCatalogStatus === 'error'}
            isLoadingCrops={cropCatalogStatus === 'loading'}
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

function buildPredictionMap(values, cropNames) {
  if (!Array.isArray(values)) return {}

  return values.reduce((predictionMap, prediction) => {
    const cropName = findCropName(cropNames, prediction?.crop)
    if (cropName) predictionMap[cropName] = prediction
    return predictionMap
  }, {})
}

function findBatchPrediction(batch, cropName) {
  if (!Array.isArray(batch?.predictions)) return null
  return (
    batch.predictions.find(
      (prediction) => normalizeCropName(prediction?.crop) === normalizeCropName(cropName),
    ) || null
  )
}

function findCropName(cropNames, cropName) {
  const normalizedName = normalizeCropName(cropName)
  if (!normalizedName) return ''
  return cropNames.find((name) => normalizeCropName(name) === normalizedName) || ''
}

function findPredictionByCrop(predictions, cropName) {
  if (!predictions || typeof predictions !== 'object') return null
  if (predictions[cropName]) return predictions[cropName]

  const storedName = Object.keys(predictions).find(
    (name) => normalizeCropName(name) === normalizeCropName(cropName),
  )
  return storedName ? predictions[storedName] : null
}

function normalizeCropName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-MY')
}
