import { useEffect, useId } from "react"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value))
  return element
}

export default function GoogleSabahMask({ maps, map, geoJson }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "")

  useEffect(() => {
    const polygons = (geoJson?.features || []).flatMap(({ geometry }) => {
      if (geometry?.type === "Polygon") return [geometry.coordinates]
      if (geometry?.type === "MultiPolygon") return geometry.coordinates
      return []
    })
    if (!polygons.length) return undefined

    // A projected SVG mask keeps every district and island clear. Separate black
    // paths combine overlapping districts without erasing their shared borders.
    const maskId = `sabah-mask-${id}`
    const container = document.createElement("div")
    Object.assign(container.style, { position: "absolute", pointerEvents: "none" })
    const svg = svgElement("svg", { "aria-hidden": "true", class: "google-sabah-mask" })
    Object.assign(svg.style, { position: "absolute", width: "100%", height: "100%" })
    const defs = svgElement("defs")
    const mask = svgElement("mask", { id: maskId, maskUnits: "userSpaceOnUse", "mask-type": "luminance" })
    const background = svgElement("rect", { fill: "white" })
    const cutouts = svgElement("g", { fill: "black", "fill-rule": "evenodd" })
    const shade = document.createElement("div")
    Object.assign(shade.style, {
      position: "absolute", inset: "0", backdropFilter: "grayscale(1)",
      background: "rgba(229, 231, 235, 0.25)", mask: `url(#${maskId})`,
    })
    mask.append(background, cutouts)
    defs.append(mask)
    svg.append(defs)
    container.append(svg, shade)

    const overlay = new maps.OverlayView()
    overlay.onAdd = () => overlay.getPanes().overlayLayer.append(container)
    overlay.onRemove = () => container.remove()
    overlay.draw = () => {
      const projection = overlay.getProjection()
      const center = projection.fromLatLngToDivPixel(map.getCenter())
      const width = map.getDiv().clientWidth
      const height = map.getDiv().clientHeight
      if (!center || !width || !height) return

      // Overscan prevents uncovered edges while the map pane moves during a drag.
      const left = center.x - width * 1.5
      const top = center.y - height * 1.5
      const extent = { x: 0, y: 0, width: width * 3, height: height * 3 }
      svg.setAttribute("viewBox", `0 0 ${extent.width} ${extent.height}`)
      Object.assign(container.style, { left: `${left}px`, top: `${top}px`, width: `${extent.width}px`, height: `${extent.height}px` })
      for (const element of [mask, background]) {
        Object.entries(extent).forEach(([key, value]) => element.setAttribute(key, value))
      }

      const worldWidth = projection.getWorldWidth()
      // Desaturate the surrounding basemap instead of hiding its pixels:
      // native labels crossing the coast remain readable in their entirety.
      const paths = []
      for (const polygon of polygons) {
        const rings = polygon.map((ring) => ring.map(([lng, lat]) =>
          projection.fromLatLngToDivPixel(new maps.LatLng(lat, lng), true)))
        const anchor = rings[0][0].x
        const nearestCopy = Math.round((center.x - anchor) / worldWidth)
        const copies = Math.ceil(extent.width / worldWidth / 2) + 1
        const d = rings.map((ring) => `${ring.map(({ x, y }, index) => `${index ? "L" : "M"}${x},${y}`).join(" ")} Z`).join(" ")
        // Google repeats the world at low zoom; keep Sabah clear in each copy.
        for (let copy = nearestCopy - copies; copy <= nearestCopy + copies; copy += 1) {
          paths.push(svgElement("path", { d, transform: `translate(${copy * worldWidth - left} ${-top})` }))
        }
      }
      cutouts.replaceChildren(...paths)
    }
    overlay.setMap(map)
    return () => overlay.setMap(null)
  }, [maps, map, geoJson, id])

  return null
}
