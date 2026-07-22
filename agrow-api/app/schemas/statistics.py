from pydantic import BaseModel, Field


class StatisticMetrics(BaseModel):
    planted_area_ha: float
    production_tonnes: float
    economic_value_myr: float
    yield_tonnes_per_ha: float


class CropStatisticRecord(StatisticMetrics):
    id: int
    crop_name: str
    year: int
    district: str | None = None


class StatisticsSummary(BaseModel):
    total_planted_area_ha: float
    total_production_tonnes: float
    total_economic_value_myr: float
    average_yield_tonnes_per_ha: float


class YearlyTrend(StatisticMetrics):
    year: int


class CropYearlyTrend(YearlyTrend):
    crop_name: str


class DistrictYearlyTrend(YearlyTrend):
    district: str | None = None


class CropComparison(StatisticMetrics):
    crop_name: str


class DistrictComparison(StatisticMetrics):
    district: str | None = None


class CropDistrictComparison(StatisticMetrics):
    crop_name: str
    district: str | None = None


class CropStatisticsResponse(BaseModel):
    record_count: int
    records: list[CropStatisticRecord] = Field(default_factory=list)
    summary: StatisticsSummary
    yearly_trends: list[YearlyTrend] = Field(default_factory=list)
    crop_yearly_trends: list[CropYearlyTrend] = Field(default_factory=list)
    district_yearly_trends: list[DistrictYearlyTrend] = Field(
        default_factory=list
    )
    crop_comparison: list[CropComparison] = Field(default_factory=list)
    district_comparison: list[DistrictComparison] = Field(default_factory=list)
    crop_district_comparison: list[CropDistrictComparison] = Field(
        default_factory=list
    )


class StatisticsOptionsResponse(BaseModel):
    crop_names: list[str] = Field(default_factory=list)
    districts: list[str] = Field(default_factory=list)
    years: list[int] = Field(default_factory=list)
    districts_by_crop: dict[str, list[str]] = Field(default_factory=dict)
