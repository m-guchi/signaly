"""認証: セッション Cookie / API キー（/api/* 用）"""

import hashlib
import os
import secrets
from typing import Optional, Set

from fastapi import HTTPException, Request
from itsdangerous import BadData, URLSafeTimedSerializer

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")
APP_URL = os.getenv("APP_URL", "/")
ALLOWED_EMAILS: Set[str] = {
    e.strip() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()
}
SECRET_KEY = os.getenv("SECRET_KEY", "")

SESSION_COOKIE = "signaly_session"
STATE_COOKIE = "signaly_oauth_state"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

API_KEY_PREFIX = "sk_"


def _signer() -> URLSafeTimedSerializer:
    key = SECRET_KEY or "dev-only-insecure-key"
    return URLSafeTimedSerializer(key, salt="signaly-auth")


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def generate_api_key() -> str:
    return f"{API_KEY_PREFIX}{secrets.token_urlsafe(32)}"


def api_key_prefix(key: str) -> str:
    return key[:12] if len(key) >= 12 else key


def sign_value(value: str) -> str:
    return _signer().dumps(value)


def load_signed_value(token: str, max_age: int) -> str:
    return _signer().loads(token, max_age=max_age)


def _get_session_email(request: Request) -> Optional[str]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    try:
        return load_signed_value(token, SESSION_MAX_AGE)
    except BadData:
        return None


def _get_bearer_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        return token or None
    return None


def get_session_email(request: Request) -> Optional[str]:
    return _get_session_email(request)


# main.py が起動時に差し替える
_resolve_api_key: Optional[callable] = None


def set_api_key_resolver(resolver) -> None:
    global _resolve_api_key
    _resolve_api_key = resolver


async def require_auth(request: Request) -> str:
    email = _get_session_email(request)
    if email:
        return email

    bearer = _get_bearer_token(request)
    if bearer and bearer.startswith(API_KEY_PREFIX) and _resolve_api_key:
        resolved = _resolve_api_key(bearer)
        if resolved:
            return resolved

    raise HTTPException(status_code=401, detail="Unauthorized")
