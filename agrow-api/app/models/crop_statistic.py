from sqlalchemy import Column, Integer, String, Numeric, DateTime
from sqlalchemy.sql import func
from app.database.session import Base

class CropStatistic(Base):
    __tablename__ = 'crop_statistics'

    id = Column(Integer, primary_key=True, index=True)
    crop_name = Column(String(100), nullable=False)
    year = Column(Integer, nullable=False, default=2024)
    planted_area_ha = Column(Numeric(10, 2), nullable=False)
    production_tonnes = Column(Numeric(10, 2), nullable=False) 
    economic_value_myr = Column(Numeric(12, 2))
    district = Column(String(100), default="Sabah")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    