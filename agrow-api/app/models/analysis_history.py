import uuid

from geoalchemy2 import Geometry
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database.session import Base


class AnalysisHistory(Base):
    __tablename__ = "analysis_history"
    __table_args__ = (
        CheckConstraint(
            "analysis_status IN ('completed', 'failed')",
            name="analysis_history_status_check",
        ),
        CheckConstraint(
            "suitability_score IS NULL OR "
            "(suitability_score >= 0 AND suitability_score <= 100)",
            name="analysis_history_score_check",
        ),
        CheckConstraint(
            "land_area_hectares > 0",
            name="analysis_history_land_area_check",
        ),
        CheckConstraint(
            "ST_IsValid(boundary)",
            name="analysis_history_valid_boundary",
        ),
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="analysis_history_user_idempotency_key",
        ),
        Index("analysis_history_user_created_idx", "user_id", "created_at"),
        Index("analysis_history_user_crop_idx", "user_id", "selected_crop"),
        Index("analysis_history_user_district_idx", "user_id", "district"),
        Index("analysis_history_user_score_idx", "user_id", "suitability_score"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(160), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    boundary = Column(
        Geometry(geometry_type="POLYGON", srid=4326, spatial_index=True),
        nullable=False,
    )
    centroid = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    land_area_hectares = Column(Float, nullable=False)

    district = Column(String(160), nullable=True)
    selected_crop = Column(String(160), nullable=True)
    suitability_score = Column(Float, nullable=True)
    confidence_level = Column(String(160), nullable=True)

    environmental_data = Column(JSONB, nullable=False, default=dict)
    forest_reserve_result = Column(JSONB, nullable=True)
    land_cover_result = Column(JSONB, nullable=True)
    prediction_result = Column(JSONB, nullable=False, default=dict)
    yield_estimate = Column(JSONB, nullable=True)
    revenue_estimate = Column(JSONB, nullable=True)
    risks = Column(JSONB, nullable=False, default=list)
    strengths = Column(JSONB, nullable=False, default=list)
    missing_data = Column(JSONB, nullable=False, default=list)
    recommended_actions = Column(JSONB, nullable=False, default=list)
    gemini_insights = Column(JSONB, nullable=True)
    analysis_status = Column(String(24), nullable=False, default="completed")
    dataset_snapshot = Column(JSONB, nullable=False, default=dict)
    analysis_version = Column(String(120), nullable=True)
    settings = Column(JSONB, nullable=False, default=dict)
    idempotency_key = Column(String(160), nullable=False)
