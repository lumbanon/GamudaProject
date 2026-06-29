from sqlalchemy import Column, BigInteger, Numeric, String, Float
from geoalchemy2 import Geometry
from app.database.session import Base

class SpatialGrid(Base):
    __tablename__ = 'spatial_grids'

    id = Column(BigInteger, primary_key=True, index=True)
    district = Column(String, nullable=False)
    latitude = Column(Numeric(9, 6), nullable=False)
    longitude = Column(Numeric(9, 6), nullable=False)
    geom = Column(Geometry(geometry_type='POINT', srid=4326))
    
    elevation_meters = Column(Numeric(6, 1), nullable=False)
    slope_pct = Column(Numeric(4, 1), nullable=False)
    soil_depth_cm = Column(BigInteger, nullable=False)
    soil_ph = Column(Numeric(3, 1), nullable=False)

    annual_rainfall_mm = Column(Float, nullable=True)
    solar_radiation = Column(Float, nullable=True)
    root_zone_moisture = Column(Float, nullable=True)
