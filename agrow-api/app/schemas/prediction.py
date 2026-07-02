from pydantic import BaseModel, Field


class CropOption(BaseModel):
    id: int | None = None
    name: str
    scientific_name: str | None = None
    min_temp_limit: float | None = None
    ideal_temp_min: float | None = None
    ideal_temp_max: float | None = None
    max_temp_limit: float | None = None
    min_annual_rainfall: float | None = None
    min_soil_depth_cm: int | None = None
    ideal_ph_min: float | None = None
    ideal_ph_max: float | None = None
    max_slope_pct: float | None = None


class EnvironmentValues(BaseModel):
    rainfall_mm: float | None = None
    temperature_c: float | None = None
    soil_ph: float | None = None
    nitrogen: float | None = None
    soc: float | None = None
    organic_carbon: float | None = None
    clay_pct: float | None = None
    sand_pct: float | None = None
    dem_m: float | None = None
    elevation_m: float | None = None
    slope_pct: float | None = None
    slope_deg: float | None = None
    soil_depth_cm: float | None = None
    land_cover: str | None = None
    solar_radiation: float | None = None
    root_zone_moisture: float | None = None
    data_source: str = "agrow_db"
    data_source_note: str | None = None
    missing_fields: list[str] = Field(default_factory=list)
    overridden_fields: list[str] = Field(default_factory=list)


class EnvironmentResponse(BaseModel):
    district: str | None = None
    sample_count: int
    values: EnvironmentValues
    available_districts: list[str] = Field(default_factory=list)


class EnvironmentOverrides(BaseModel):
    rainfall_mm: float | None = None
    temperature_c: float | None = None
    soil_ph: float | None = None
    nitrogen: float | None = None
    soc: float | None = None
    organic_carbon: float | None = None
    clay_pct: float | None = None
    sand_pct: float | None = None
    dem_m: float | None = None
    elevation_m: float | None = None
    slope_pct: float | None = None
    slope_deg: float | None = None
    soil_depth_cm: float | None = None
    land_cover: str | None = None
    solar_radiation: float | None = None
    root_zone_moisture: float | None = None


class SuitabilityRequest(BaseModel):
    crop: str
    district: str | None = None
    polygon: list[list[float]] | None = None
    user_inputs: EnvironmentOverrides | None = None


class SuitabilityDetail(BaseModel):
    score: int
    status: str
    strengths: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    risk_level: str
    risk_warnings: list[str] = Field(default_factory=list)
    confidence: str


class PlantingWindow(BaseModel):
    best_months: list[str] = Field(default_factory=list)
    reason: str


class ReturnEstimate(BaseModel):
    estimated_yield_tonnes: float | None = None
    estimated_revenue_myr: float | None = None
    confidence: str
    basis: str


class SuitabilityResponse(BaseModel):
    crop: str
    district: str | None = None
    area_hectares: float | None = None
    suitability_score: int
    matched_environment: EnvironmentValues
    features: EnvironmentValues
    suitability: SuitabilityDetail
    explanation: str
    recommendations: list[str] = Field(default_factory=list)
    planting_window: PlantingWindow
    return_estimate: ReturnEstimate
    ai_insight: str
