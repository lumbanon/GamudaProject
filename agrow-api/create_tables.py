from sqlalchemy import text

from app.database.session import Base, DATABASE_URL, engine

print(f"⏳ Connecting to database on: {DATABASE_URL.split('@')[-1]}")
from app.models.user import User  
from app.models.crop import Crop
from app.models.spatial_grid import SpatialGrid
from app.models.crop_statistic import CropStatistic
from app.models.analysis_history import AnalysisHistory

def initialize_database():
    try:
        with engine.connect() as connection:
            print("🌐 Activating PostGIS extension in PostgreSQL...")
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
            connection.commit()
            print("✔️ PostGIS extension is active!")

        print("🧱 Generating database tables from models...")
        Base.metadata.create_all(bind=engine)
        print("🎉 All database tables successfully generated!")

    except Exception as e:
        print(f"❌ Database initialization failed: {str(e)}")
        print("\n💡 Troubleshooting Tips:")
        print("1. Make sure PostgreSQL is currently running on your system.")
        print("2. Verify that your DB user has permissions to install extensions.")
        print("3. Double check the password in your .env matches your DB configuration.")

if __name__ == "__main__":
    initialize_database()
