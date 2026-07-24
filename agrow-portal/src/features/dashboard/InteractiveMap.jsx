import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import sabahGeoJSON from '../../assets/maps/sabah-districts.json'
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
                        >
                            <option value='' disabled>Select a crop...</option>
                            <option value='Banana'>Banana</option>
                            <option value='Cabbage'>Cabbage</option>
                            <option value='Durian'>Durian</option>
                            <option value='Watermelon'>Watermelon</option>
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
    )
}
