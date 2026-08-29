import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import sabahGeoJSON from '../../assets/maps/sabah-districts.json'
import {
    CARTO_BASEMAP_ATTRIBUTION,
    CARTO_BASEMAP_URL,
} from '../../config/cartoBasemap'
import 'leaflet/dist/leaflet.css'

const SABAH_BOUNDS = [[3.8, 114.3], [7.5, 119.5]]

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

export default function InteractiveMap({
    activeCrop,
    cropOptions = [],
    hasCropCatalogError = false,
    isLoadingCrops = false,
    setActiveCrop,
    onEachDistrictPolygon,
    getDistrictStyle
}) {
    const geoJsonRef = useRef(null)

    // Explicitly update style maps when dependency parameters change
    useEffect(() => {
        if (geoJsonRef.current) {
            geoJsonRef.current.eachLayer((layer) => {
                if (layer.feature) {
                    layer.setStyle(getDistrictStyle(layer.feature))
                }
            })
        }
    }, [getDistrictStyle])

    return (
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
                            disabled={
                                isLoadingCrops ||
                                hasCropCatalogError ||
                                cropOptions.length === 0
                            }
                        >
                            <option value=''>
                                {getCropSelectPlaceholder({
                                    hasCropCatalogError,
                                    isLoadingCrops,
                                    hasCropOptions: cropOptions.length > 0,
                                })}
                            </option>
                            {cropOptions.map((crop) => (
                                <option value={crop.name} key={crop.id || crop.name}>
                                    {crop.name}
                                </option>
                            ))}
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
                    <TileLayer
                        attribution={CARTO_BASEMAP_ATTRIBUTION}
                        maxZoom={20}
                        subdomains='abcd'
                        url={CARTO_BASEMAP_URL}
                    />

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
    )
}

function getCropSelectPlaceholder({
    hasCropCatalogError,
    isLoadingCrops,
    hasCropOptions,
}) {
    if (isLoadingCrops) return 'Loading crops...'
    if (hasCropCatalogError) return 'Crops unavailable'
    if (!hasCropOptions) return 'No crops available'
    return 'Select a crop...'
}
