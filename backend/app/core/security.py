"""Demo token auth.

Issues an HMAC-signed token (header.payload.signature, JWT-shaped) after
checking demo credentials. Deliberately simple so a real JWT flow can replace
`issue_token`/`verify_token` + `get_current_user` without touching routes.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import Depends, HTTPException, Request

from app.core.config import settings

DEMO_USERS = {
    "admin@supplychainiq.com": {"password": "admin123", "name": "Aarav Sharma", "role": "admin"},
    "manager@supplychainiq.com": {"password": "manager123", "name": "Priya Menon", "role": "manager"},
}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _signature(payload: str) -> str:
    secret = settings.token_secret.encode()
    return _b64(hmac.new(secret, payload.encode(), hashlib.sha256).digest())


def issue_token(email: str, role: str) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64(json.dumps({
        "sub": email, "role": role,
        "exp": int(time.time()) + settings.token_expire_minutes * 60,
    }).encode())
    payload = f"{header}.{body}"
    return f"{payload}.{_signature(payload)}"


def verify_token(token: str) -> dict:
    try:
        payload, sig = token.rsplit(".", 1)[0], token.rsplit(".", 1)[1]
    except ValueError:
        raise HTTPException(status_code=401, detail="Malformed token")
    if not hmac.compare_digest(_signature(payload), sig):
        raise HTTPException(status_code=401, detail="Invalid token signature")
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload.split(".")[1] + "=="))
    except Exception:
        raise HTTPException(status_code=401, detail="Malformed token payload")
    if claims.get("exp", 0) < time.time():
        raise HTTPException(status_code=401, detail="Token expired")
    return claims


def authenticate(email: str, password: str) -> dict:
    user = DEMO_USERS.get(email.lower().strip())
    if not user or user["password"] != password:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"email": email.lower().strip(), "name": user["name"], "role": user["role"]}


def get_current_user(request: Request) -> dict:
    """Optional-guard dependency: reads the Authorization bearer token if present.

    The demo frontend always sends it; routes that are public simply don't depend
    on this function, keeping the JWT swap-in point centralized.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return verify_token(auth.removeprefix("Bearer ").strip())


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user
