from fastapi import APIRouter, HTTPException, Response, status, Depends
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
import bcrypt

from app.database.session import get_db
from app.models.user import User
from app.core.security import ALGORITHM, SECRET_KEY, verify_password, create_access_token

router =  APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
ALLOWED_EMAIL_DOMAINS = {
    'gmail.com',
    'hotmail.com',
    'icloud.com',
    'live.com',
    'outlook.com',
    'proton.me',
    'protonmail.com',
    'yahoo.com',
    'ymail.com',
}

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

class UserUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')

    full_name: str | None = None
    email: EmailStr | None = None

class CurrentUserUpdate(CurrentUser):
    access_token: str
    token_type: str = 'bearer'

class PasswordChange(BaseModel):
    model_config = ConfigDict(extra='forbid')

    current_password: str
    new_password: str

class PasswordChangeConfirmation(BaseModel):
    message: str

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

@router.patch('/me', response_model=CurrentUserUpdate)
def update_current_user(
    user_in: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updates = user_in.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='Provide at least one account field to update',
        )

    if any(value is None for value in updates.values()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='Account fields cannot be null',
        )

    if 'full_name' in updates:
        updates['full_name'] = updates['full_name'].strip()
        if not updates['full_name']:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail='Full name cannot be blank',
            )

    if 'email' in updates:
        normalized_email = str(updates['email']).strip().lower()
        email_domain = normalized_email.rsplit('@', 1)[-1]
        if email_domain not in ALLOWED_EMAIL_DOMAINS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    'Use an email from a supported provider such as Gmail, '
                    'Hotmail, Outlook, Yahoo, iCloud, Live, or Proton.'
                ),
            )

        duplicate_user = (
            db.query(User.id)
            .filter(
                func.lower(User.email) == normalized_email,
                User.id != current_user.id,
            )
            .first()
        )
        if duplicate_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail='An account with this email already exists.',
            )
        updates['email'] = normalized_email

    for field_name, value in updates.items():
        setattr(current_user, field_name, value)

    try:
        db.commit()
        db.refresh(current_user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='An account with this email already exists.',
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Unable to update your account',
        ) from exc

    return {
        'id': current_user.id,
        'full_name': current_user.full_name,
        'email': current_user.email,
        'role': current_user.role,
        'access_token': create_access_token(data={'sub': current_user.email}),
        'token_type': 'bearer',
    }

@router.patch('/me/password', response_model=PasswordChangeConfirmation)
def change_current_user_password(
    password_in: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_password_bytes = password_in.current_password.encode('utf-8')
    if (
        len(current_password_bytes) > 72
        or not verify_password(
            password_in.current_password,
            current_user.hashed_password,
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Current password is incorrect',
        )

    if len(password_in.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='New password must be at least 6 characters',
        )

    new_password_bytes = password_in.new_password.encode('utf-8')
    if len(new_password_bytes) > 72:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='New password must be 72 bytes or fewer',
        )

    if password_in.new_password == password_in.current_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='New password must be different from the current password',
        )

    try:
        current_user.hashed_password = bcrypt.hashpw(
            new_password_bytes,
            bcrypt.gensalt(),
        ).decode('utf-8')
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='New password is too long',
        ) from exc

    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Unable to update your password',
        ) from exc

    return {'message': 'Password updated successfully.'}

@router.delete('/me', status_code=status.HTTP_204_NO_CONTENT)
def delete_current_user(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        db.delete(current_user)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Unable to delete your account',
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)
