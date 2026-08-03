from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class HistoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=160)
    boundary: list[list[float]]
    district: str | None = Field(default=None, max_length=160)
    selected_crop: str | None = Field(default=None, max_length=160)
    suitability_score: float | None = Field(default=None, ge=0, le=100)
    confidence_level: str | None = Field(default=None, max_length=160)
    environmental_data: dict[str, Any] = Field(default_factory=dict)
    forest_reserve_result: dict[str, Any] | None = None
    land_cover_result: dict[str, Any] | None = None
    prediction_result: dict[str, Any] = Field(default_factory=dict)
    yield_estimate: dict[str, Any] | None = None
    revenue_estimate: dict[str, Any] | None = None
    risks: list[Any] = Field(default_factory=list)
    strengths: list[Any] = Field(default_factory=list)
    missing_data: list[Any] = Field(default_factory=list)
    recommended_actions: list[Any] = Field(default_factory=list)
    gemini_insights: dict[str, Any] | None = None
    analysis_status: Literal["completed", "failed"] = "completed"
    dataset_snapshot: dict[str, Any] = Field(default_factory=dict)
    analysis_version: str | None = Field(default=None, max_length=120)
    settings: dict[str, Any] = Field(default_factory=dict)


class HistoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(max_length=160)


class HistoryRecord(BaseModel):
    id: UUID
    name: str | None
    created_at: datetime
    updated_at: datetime
    boundary: list[list[float]]
    centroid: dict[str, float]
    land_area_hectares: float
    district: str | None
    selected_crop: str | None
    suitability_score: float | None
    confidence_level: str | None
    environmental_data: dict[str, Any]
    forest_reserve_result: dict[str, Any] | None
    land_cover_result: dict[str, Any] | None
    prediction_result: dict[str, Any]
    yield_estimate: dict[str, Any] | None
    revenue_estimate: dict[str, Any] | None
    risks: list[Any]
    strengths: list[Any]
    missing_data: list[Any]
    recommended_actions: list[Any]
    gemini_insights: dict[str, Any] | None
    analysis_status: str
    dataset_snapshot: dict[str, Any]
    analysis_version: str | None
    settings: dict[str, Any]


class HistoryListResponse(BaseModel):
    items: list[HistoryRecord]
    total: int
    page: int
    page_size: int
    pages: int


class HistoryRestoreResponse(BaseModel):
    history_id: UUID
    boundary: list[list[float]]
    selected_crop: str | None
    district: str | None
    source_analysis_date: datetime
    saved_results: dict[str, Any]
