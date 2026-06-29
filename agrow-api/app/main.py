from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database.session import engine, Base
from app.models.user import User
from app.api.endpoints import auth, predict

Base.metadata.create_all(bind=engine)

app =  FastAPI()

origins = [
    'http://localhost:5173'
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

#routers
app.include_router(auth.router, prefix='/api/v1/auth', tags=['authentication'])
app.include_router(predict.router, prefix='/api/predict', tags=['ai predictions'])


@app.get('/')
def read_root():
    return {'message': 'hi'}