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
    raster_land_cover: str | None = None
    land_cover_source: str | None = None
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
    latitude: float | None = None
    longitude: float | None = None
    polygon: list[list[float]] | None = None
    user_inputs: EnvironmentOverrides | None = None
    satellite_image_data_url: str | None = Field(default=None, max_length=10_000_000)


class ForestReserveValidationRequest(BaseModel):
    polygon: list[list[float]] | None = None


class ForestReserveValidationResponse(BaseModel):
    allowed: bool = True
    reserved_forest: bool = False
    blocked_reason: str | None = None
    message: str | None = None
    reserved_overlap_m2: float = 0
    reserved_forest_geojson: dict | None = None
    reserved_overlap_geojson: dict | None = None
    forest_reserve_check_warning: str | None = None


class SuitabilityDetail(BaseModel):
    score: int
    status: str
    classification: str | None = None
    confidence_matrix: dict[str, float] = Field(default_factory=dict)
    model_confidence_pct: float | None = None
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


class GenAiInsight(BaseModel):
    crop_suitability_summary: str
    key_strengths: list[str] = Field(default_factory=list)
    potential_risks: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    confidence_level: str
    missing_data: list[str] = Field(default_factory=list)
    source: str = "fallback"
    model: str | None = None
    fallback_used: bool = False
    fallback_reason: str | None = None


class SatelliteBuildingAnalysis(BaseModel):
    status: str
    buildings_detected: bool | None = None
    is_built_up: bool | None = None
    estimated_built_up_percent: float | None = None
    confidence: str | None = None
    image_quality: str | None = None
    explanation: str | None = None
    land_cover_override_recommended: bool = False
    model: str | None = None
    image_bytes: int | None = None
    failure_reason: str | None = None


class SuitabilityResponse(BaseModel):
    allowed: bool = True
    reserved_forest: bool = False
    blocked_reason: str | None = None
    message: str | None = None
    reserved_overlap_m2: float = 0
    reserved_forest_geojson: dict | None = None
    reserved_overlap_geojson: dict | None = None
    forest_reserve_check_warning: str | None = None
    crop: str
    district: str | None = None
    area_hectares: float | None = None
    suitability_score: int | None = None
    suitability_class: str | None = None
    confidence_matrix: dict[str, float] = Field(default_factory=dict)
    matched_environment: EnvironmentValues | None = None
    features: EnvironmentValues | None = None
    suitability: SuitabilityDetail | None = None
    explanation: str | None = None
    recommendations: list[str] = Field(default_factory=list)
    planting_window: PlantingWindow | None = None
    return_estimate: ReturnEstimate | None = None
    ai_insight: str | None = None
    genai_insight: GenAiInsight | None = None
    satellite_building_analysis: SatelliteBuildingAnalysis | None = None
