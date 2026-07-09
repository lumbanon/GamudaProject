from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database.session import engine, Base
from app.models.crop import Crop
from app.models.crop_statistic import CropStatistic
from app.models.spatial_grid import SpatialGrid
from app.models.user import User
from app.api.endpoints import auth, crop_suitability, predict, prediction

Base.metadata.create_all(bind=engine)

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["authentication"])
app.include_router(predict.router, prefix="/api/predict", tags=["ai predictions"])
app.include_router(crop_suitability.router, prefix="/api/crop-suitability", tags=["crop suitability"])
app.include_router(prediction.router, prefix="/api/prediction", tags=["prediction"])

@app.get("/")
def read_root():
    return {'message': 'this is agrow by cleek'}
