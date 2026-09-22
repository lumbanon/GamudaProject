import { useEffect, useRef } from "react"
import { coordinatesFromPath, googlePath } from "./googleMaps"

export default function GoogleBoundaryLayer({ maps, map, points, drawing, blocked, disabled, editVersion, onEdit, onAddPoint }) {
  const layerRef = useRef(null)
  const updatingRef = useRef(false)
  const onEditRef = useRef(onEdit)
  const onClickRef = useRef(null)
  const polygon = points.length >= 3
  useEffect(() => { onEditRef.current = onEdit }, [onEdit])
  useEffect(() => {
    onClickRef.current = (event) => {
      if (drawing && !disabled && event.latLng && event.vertex === undefined && event.edge === undefined) {
        onAddPoint(event)
      }
    }
  }, [drawing, disabled, onAddPoint])
  useEffect(() => {
    if (!map) return undefined
    const shape = polygon ? new maps.Polygon({ map }) : new maps.Polyline({ map })
    layerRef.current = shape
    const clickListener = shape.addListener("click", (event) => onClickRef.current?.(event))
    return () => { clickListener.remove(); shape.setMap(null); layerRef.current = null }
  }, [map, maps, polygon])
  useEffect(() => {
    const shape = layerRef.current
    if (!shape) return undefined
    // Preserve Google's live editable path during dragging whenever it matches.
    if (JSON.stringify(coordinatesFromPath(shape.getPath())) !== JSON.stringify(points)) {
      updatingRef.current = true; shape.setPath(googlePath(points)); updatingRef.current = false
    }
    shape.setOptions({ editable: !disabled, clickable: true,
      strokeColor: blocked ? "#b42318" : drawing ? "#1a73e8" : "#e5b83f",
      strokeWeight: 3, strokeOpacity: 1, fillColor: blocked ? "#e5483e" : "#4caa68", fillOpacity: 0.24 })
    const listeners = ["set_at", "insert_at", "remove_at"].map((event) => shape.getPath().addListener(event, () => {
      if (!updatingRef.current) onEditRef.current(coordinatesFromPath(shape.getPath()))
    }))
    return () => listeners.forEach((listener) => listener.remove())
  }, [points, blocked, disabled, drawing, polygon, map, editVersion])
  return null
}
