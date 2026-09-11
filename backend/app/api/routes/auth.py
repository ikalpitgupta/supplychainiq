"""Auth routes: demo login + token validation."""
from fastapi import APIRouter, Depends

from app.core.security import authenticate, get_current_user, issue_token
from app.schemas import LoginRequest
from app.utils.errors import APIError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(payload: LoginRequest):
    try:
        user = authenticate(payload.email, payload.password)
    except Exception:
        raise APIError("Invalid email or password", status_code=401)
    return {"token": issue_token(user["email"], user["role"]), "user": user}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": user}
