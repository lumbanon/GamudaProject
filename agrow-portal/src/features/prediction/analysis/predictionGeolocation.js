export const POOR_GPS_ACCURACY_METRES = 100

export function requestCurrentPosition(
  geolocation = globalThis.navigator?.geolocation,
  options = {},
) {
  if (!geolocation?.getCurrentPosition) {
    return Promise.reject(
      Object.assign(new Error("Your browser does not support location access."), {
        code: "UNSUPPORTED_GEOLOCATION",
      }),
    )
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000,
      ...options,
    })
  })
}

export function coordinateFromPosition(position) {
  const latitude = Number(position?.coords?.latitude)
  const longitude = Number(position?.coords?.longitude)
  const accuracy = Number(position?.coords?.accuracy)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Your device returned invalid location coordinates.")
  }

  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  }
}

export function geolocationErrorMessage(error) {
  if (error?.code === "UNSUPPORTED_GEOLOCATION") {
    return "Your browser does not support location access."
  }
  if (error?.code === 1) {
    return "Location permission was denied. You can continue by clicking the map."
  }
  if (error?.code === 2) {
    return "Location services are unavailable. Check your device settings and try again."
  }
  if (error?.code === 3) {
    return "The location request timed out. Move to an open area and try again."
  }
  return error?.message || "Unable to retrieve your current location."
}

export function accuracyWarning(accuracy, threshold = POOR_GPS_ACCURACY_METRES) {
  const value = Number(accuracy)
  if (!Number.isFinite(value) || value <= threshold) return ""
  return `GPS accuracy is approximately ${Math.round(value)} m. Check the point and drag it if needed.`
}
