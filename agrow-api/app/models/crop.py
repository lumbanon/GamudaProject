from sqlalchemy import Column, Integer, String, Numeric, DateTime
from sqlalchemy.sql import func
from app.database.session import Base

class Crop(Base):
    __tablename__ = 'crops'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    scientific_name = Column(String(150))
    min_temp_limit = Column(Numeric(4, 2), nullable=False, default=15.00)
    ideal_temp_min = Column(Numeric(4, 2), nullable=False, default=15.00)
    ideal_temp_max = Column(Numeric(4, 2), nullable=False, default=15.00)
    max_temp_limit = Column(Numeric(4, 2), nullable=False, default=15.00)
    min_annual_rainfall = Column(Numeric(6,1), nullable=False, default=60)
    min_soil_depth_cm = Column(Integer, nullable=False, default=60)
    ideal_ph_min = Column(Numeric(3, 1), nullable=False, default=5.5)
    ideal_ph_max = Column(Numeric(3, 1), nullable=False, default=7.5)
    max_slope_pct = Column(Numeric(4, 1), nullable=False, default=15.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    