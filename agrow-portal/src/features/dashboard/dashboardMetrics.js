const cropNames = ["Corn", "Banana", "Cocoa"];

export function getDistrictSuitability(district = "Sandakan") {
  return cropNames.reduce((scores, crop) => {
    scores[crop] = getCropScore(district, crop);
    return scores;
  }, {});
}

export function getDistrictRainfall(district = "Sandakan") {
  if (district === "Sandakan") return 3200;
  return 1900 + (hashString(`${district}-rainfall`) % 1800);
}

export function getCropScore(district, crop) {
  if (district === "Sandakan") return 60;

  const cropOffset = {
    Banana: 4,
    Corn: 0,
    Cocoa: -3,
  }[crop] || 0;

  return clamp(43 + (hashString(`${district}-${crop}`) % 43) + cropOffset, 35, 90);
}

function hashString(value) {
  return Array.from(value).reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) >>> 0;
  }, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
