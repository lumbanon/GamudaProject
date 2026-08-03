from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.endpoints.auth import get_current_user
from app.database.session import get_db
from app.models.user import User
from app.schemas.history import (
    HistoryCreate,
    HistoryListResponse,
    HistoryRecord,
    HistoryRestoreResponse,
    HistoryUpdate,
)
from app.services import history_service


router = APIRouter()


@router.post("", response_model=HistoryRecord, status_code=status.HTTP_201_CREATED)
def save_history(
    payload: HistoryCreate,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=8,
        max_length=160,
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return history_service.create_history(
        db,
        user_id=current_user.id,
        payload=payload,
        idempotency_key=idempotency_key,
    )


@router.get("", response_model=HistoryListResponse)
def read_history(
    search: str | None = Query(default=None, max_length=160),
    crop: str | None = Query(default=None, max_length=160),
    district: str | None = Query(default=None, max_length=160),
    date_from: date | None = None,
    date_to: date | None = None,
    min_score: float | None = Query(default=None, ge=0, le=100),
    max_score: float | None = Query(default=None, ge=0, le=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    sort_by: Literal[
        "created_at",
        "updated_at",
        "name",
        "crop",
        "district",
        "area",
        "score",
    ] = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please choose a start date that is on or before the end date.",
        )
    if min_score is not None and max_score is not None and min_score > max_score:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="min_score must not exceed max_score.",
        )

    return history_service.list_history(
        db,
        user_id=current_user.id,
        search=search,
        crop=crop,
        district=district,
        date_from=date_from,
        date_to=date_to,
        min_score=min_score,
        max_score=max_score,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/{history_id}", response_model=HistoryRecord)
def read_history_record(
    history_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return history_service.get_history(
        db,
        user_id=current_user.id,
        history_id=history_id,
    )


@router.patch("/{history_id}", response_model=HistoryRecord)
def rename_history_record(
    history_id: UUID,
    payload: HistoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return history_service.update_history_name(
        db,
        user_id=current_user.id,
        history_id=history_id,
        name=payload.name,
    )


@router.delete("/{history_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_history_record(
    history_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    history_service.delete_history(
        db,
        user_id=current_user.id,
        history_id=history_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{history_id}/restore", response_model=HistoryRestoreResponse)
def restore_history_record(
    history_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return history_service.restore_history(
        db,
        user_id=current_user.id,
        history_id=history_id,
    )
