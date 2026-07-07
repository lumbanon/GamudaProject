import os
import bcrypt
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt
# from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET_KEY") or "dev-secret-key-change-me"
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60))

# pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__backend='bcrypt')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    # return pwd_context.verify(plain_password, hashed_password)
    password_bytes = plain_password.encode('utf-8')
    hashed_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hashed_bytes)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
