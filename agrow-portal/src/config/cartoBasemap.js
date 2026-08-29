const cartoApiKey = import.meta.env.VITE_CARTO_API_KEY?.trim()

export const CARTO_BASEMAP_URL =
  `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoApiKey || '')}`

export const CARTO_BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
