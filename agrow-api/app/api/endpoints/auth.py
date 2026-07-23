from fastapi import APIRouter, Depends, HTTPException, Response, status
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

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


class Token(BaseModel):
    access_token: str
    token_type: str
    user_role: str


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
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


def hash_password(password: str) -> str:
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password exceeds maximum length of 72 bytes.",
        )
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode('utf-8')


@router.post('/register', status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    normalized_email = str(user_in.email).strip().lower()

    existing_user = (
        db.query(User)
        .filter(func.lower(User.email) == normalized_email)
        .first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='email already existed'
        )

    hashed_password_string = hash_password(user_in.password)

    new_user = User(
        full_name=user_in.full_name.strip(),
        email=normalized_email,
        hashed_password=hashed_password_string,
        role=user_in.role,
        is_active=True
    )

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='email already existed',
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Unable to register user',
        ) from exc


@router.post('/login', response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    normalized_email = form_data.username.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == normalized_email).first()

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

    if password_in.new_password == password_in.current_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='New password must be different from the current password',
        )

    current_user.hashed_password = hash_password(password_in.new_password)

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