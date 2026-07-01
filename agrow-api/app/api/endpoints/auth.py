from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
import bcrypt

from app.database.session import get_db
from app.models.user import User
from app.core.security import ALGORITHM, SECRET_KEY, verify_password, create_access_token

router =  APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

class Token(BaseModel):
    access_token: str
    token_type: str
    user_role: str

class UserCreate(BaseModel):
    full_name : str
    email : EmailStr
    password: str
    role: str

class CurrentUser(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: str

@router.post('/register', status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='email already existed'
        )
    
    password_bytes = user_in.password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_password_string = bcrypt.hashpw(password_bytes, salt).decode('utf-8')

    new_user = User(
        full_name = user_in.full_name,
        email = user_in.email,
        hashed_password=hashed_password_string,
        role=user_in.role,
        is_active=True
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

@router.post('/login', response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": user.email})
    
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user_role": user.role
    }

@router.get('/me', response_model=CurrentUser)
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise credentials_error
    except JWTError as exc:
        raise credentials_error from exc

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise credentials_error

    return user
