import json
import asyncio
import hashlib
import os
import secrets
import urllib.parse
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional, Set

import httpx
from itsdangerous import URLSafeTimedSerializer, BadData
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from database import Channel, Notification, PushSubscription, get_session, init_db
from push import push_configured, send_push_notifications

BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# channel_name → list of subscriber queues
_subscribers: Dict[str, List[asyncio.Queue]] = {}

# ── Auth config ───────────────────────────────────────────────────────────────

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")
APP_URL = os.getenv("APP_URL", "/")
ALLOWED_EMAILS: Set[str] = {
    e.strip() for e in os.getenv("ALLOWED_EMAILS", "").split(",") if e.strip()
}
SECRET_KEY = os.getenv("SECRET_KEY", "")

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")

SESSION_COOKIE = "signaly_session"
STATE_COOKIE = "signaly_oauth_state"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def _signer() -> URLSafeTimedSerializer:
    key = SECRET_KEY or "dev-only-insecure-key"
    return URLSafeTimedSerializer(key, salt="signaly-auth")


def _get_session_email(request: Request) -> Optional[str]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    try:
        return _signer().loads(token, max_age=SESSION_MAX_AGE)
    except BadData:
        return None


async def require_auth(request: Request) -> str:
    email = _get_session_email(request)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return email


# ── DB helpers（threadpool で呼ぶ）────────────────────────────────────────────

def _fetch_channels() -> Dict[str, str]:
    """channel_id -> channel_name のマッピングを返す"""
    with get_session() as session:
        rows = session.query(Channel).all()
        return {row.id: row.name for row in rows}


def _webhook_url(request: Request, channel_id: str) -> str:
    return str(f"{request.base_url}webhook/{channel_id}")


def _create_channel(name: str) -> Dict[str, str]:
    channel_id = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    with get_session() as session:
        if session.query(Channel).filter(Channel.name == name).first():
            raise ValueError("duplicate")
        session.add(
            Channel(
                id=channel_id,
                name=name,
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()
    return {"id": channel_id, "name": name}


def _save_notification(entry: dict) -> None:
    with get_session() as session:
        session.add(
            Notification(
                id=entry["id"],
                channel=entry["channel"],
                title=entry["title"],
                message=entry["message"],
                level=entry["level"],
                timestamp=datetime.fromisoformat(entry["timestamp"]),
                fields=json.dumps(entry["fields"], ensure_ascii=False) if entry.get("fields") else None,
                color=entry.get("color"),
            )
        )
        session.commit()


def _fetch_history(channel_name: str, limit: int) -> List[dict]:
    with get_session() as session:
        rows = (
            session.query(Notification)
            .filter(Notification.channel == channel_name)
            .order_by(Notification.timestamp.asc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r.id,
                "channel": r.channel,
                "title": r.title,
                "message": r.message,
                "level": r.level,
                "timestamp": r.timestamp.isoformat(),
                "fields": json.loads(r.fields) if getattr(r, "fields", None) else None,
                "color": getattr(r, "color", None),
            }
            for r in rows
        ]


def _endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()


def _upsert_push_subscription(email: str, endpoint: str, p256dh: str, auth: str) -> None:
    now = datetime.now(timezone.utc)
    ep_hash = _endpoint_hash(endpoint)
    with get_session() as session:
        existing = session.query(PushSubscription).filter(PushSubscription.endpoint_hash == ep_hash).first()
        if existing:
            existing.email = email
            existing.endpoint = endpoint
            existing.p256dh = p256dh
            existing.auth = auth
            existing.updated_at = now
        else:
            session.add(
                PushSubscription(
                    id=str(uuid.uuid4()),
                    email=email,
                    endpoint_hash=ep_hash,
                    endpoint=endpoint,
                    p256dh=p256dh,
                    auth=auth,
                    created_at=now,
                    updated_at=now,
                )
            )
        session.commit()


def _delete_push_subscription(endpoint: str) -> None:
    ep_hash = _endpoint_hash(endpoint)
    with get_session() as session:
        row = session.query(PushSubscription).filter(PushSubscription.endpoint_hash == ep_hash).first()
        if row:
            session.delete(row)
            session.commit()


# ── App ───────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Signaly", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.get("/auth/login")
async def auth_login():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth が設定されていません")

    state = secrets.token_urlsafe(16)
    signed_state = _signer().dumps(state)

    params = urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email",
        "state": state,
    })
    response = RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")
    response.set_cookie(STATE_COOKIE, signed_state, httponly=True, samesite="lax", max_age=600)
    return response


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str, state: str):
    # state 検証（CSRF 対策）
    signed_state = request.cookies.get(STATE_COOKIE)
    if not signed_state:
        raise HTTPException(status_code=400, detail="不正なリクエストです（state cookie なし）")
    try:
        expected_state = _signer().loads(signed_state, max_age=600)
    except BadData:
        raise HTTPException(status_code=400, detail="不正なリクエストです（state 無効）")
    if expected_state != state:
        raise HTTPException(status_code=400, detail="不正なリクエストです（state 不一致）")

    # code → access_token に交換
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Google との認証に失敗しました")

    access_token = token_resp.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="アクセストークンが取得できませんでした")

    # メールアドレスを取得
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if user_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="ユーザー情報の取得に失敗しました")

    email: str = user_resp.json().get("email", "")
    if not email or email not in ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="このアカウントはアクセスが許可されていません")

    session_token = _signer().dumps(email)
    response = RedirectResponse(url=APP_URL, status_code=302)
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
    )
    response.delete_cookie(STATE_COOKIE)
    return response


@app.get("/auth/me")
async def auth_me(request: Request):
    email = _get_session_email(request)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"email": email}


@app.post("/auth/logout")
async def auth_logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


# ── Webhook（認証不要：外部サービスから叩く）──────────────────────────────────

class WebhookPayload(BaseModel):
    message: str = ""
    title: str = ""
    level: str = "info"  # info | warning | error
    color: Optional[str] = None  # CSS hex e.g. #57f287
    fields: Optional[List[dict]] = None  # [{name, value, inline}]


@app.post("/webhook/{channel_id}")
async def receive_webhook(channel_id: str, payload: WebhookPayload):
    channels = await asyncio.to_thread(_fetch_channels)
    if channel_id not in channels:
        raise HTTPException(status_code=404, detail="Channel not found")

    channel_name = channels[channel_id]
    entry = {
        "id": str(uuid.uuid4()),
        "channel": channel_name,
        "title": payload.title,
        "message": payload.message,
        "level": payload.level,
        "color": payload.color,
        "fields": payload.fields,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    await asyncio.to_thread(_save_notification, entry)

    for q in list(_subscribers.get(channel_name, [])):
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            _subscribers[channel_name].remove(q)

    asyncio.create_task(asyncio.to_thread(send_push_notifications, entry))

    return {"ok": True, "id": entry["id"]}


# ── API（要認証）─────────────────────────────────────────────────────────────

class CreateChannelRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("チャンネル名を入力してください")
        if len(v) > 100:
            raise ValueError("チャンネル名は100文字以内にしてください")
        return v


@app.get("/api/channels")
async def get_channels(request: Request, email: str = Depends(require_auth)):
    channels = await asyncio.to_thread(_fetch_channels)
    items = [
        {
            "id": cid,
            "name": name,
            "webhook_url": _webhook_url(request, cid),
        }
        for cid, name in channels.items()
    ]
    items.sort(key=lambda c: c["name"])
    return {"channels": items}


@app.post("/api/channels")
async def create_channel(
    request: Request,
    body: CreateChannelRequest,
    email: str = Depends(require_auth),
):
    try:
        created = await asyncio.to_thread(_create_channel, body.name)
    except ValueError:
        raise HTTPException(status_code=409, detail="同じ名前のチャンネルが既に存在します")

    return {
        "id": created["id"],
        "name": created["name"],
        "webhook_url": _webhook_url(request, created["id"]),
    }


@app.get("/api/history/{channel_name}")
async def get_history(channel_name: str, limit: int = 200, email: str = Depends(require_auth)):
    channels = await asyncio.to_thread(_fetch_channels)
    if channel_name not in channels.values():
        raise HTTPException(status_code=404, detail="Channel not found")

    logs = await asyncio.to_thread(_fetch_history, channel_name, limit)
    return {"logs": logs}


@app.get("/api/stream/{channel_name}")
async def stream_events(channel_name: str, request: Request, email: str = Depends(require_auth)):
    channels = await asyncio.to_thread(_fetch_channels)
    if channel_name not in channels.values():
        raise HTTPException(status_code=404, detail="Channel not found")

    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.setdefault(channel_name, []).append(queue)

    # 2KB 超の SSE コメントでプロキシ（Cloudflare / Apache / nginx）のバッファリングを回避
    _SSE_FLUSH = ":" + " " * 2048 + "\n\n"

    async def generate() -> AsyncIterator[str]:
        try:
            yield _SSE_FLUSH
            yield "event: ping\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield _SSE_FLUSH
                    yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield _SSE_FLUSH
                    yield "event: ping\ndata: {}\n\n"
        finally:
            subs = _subscribers.get(channel_name, [])
            if queue in subs:
                subs.remove(queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Web Push ──────────────────────────────────────────────────────────────────

class PushSubscribeBody(BaseModel):
    endpoint: str
    keys: dict

    @field_validator("keys")
    @classmethod
    def validate_keys(cls, v: dict) -> dict:
        if not v.get("p256dh") or not v.get("auth"):
            raise ValueError("keys.p256dh と keys.auth が必要です")
        return v


@app.get("/api/push/vapid-public-key")
async def push_vapid_public_key(email: str = Depends(require_auth)):
    if not push_configured():
        raise HTTPException(status_code=503, detail="Web Push が設定されていません")
    return {"publicKey": VAPID_PUBLIC_KEY}


@app.post("/api/push/subscribe")
async def push_subscribe(body: PushSubscribeBody, email: str = Depends(require_auth)):
    if not push_configured():
        raise HTTPException(status_code=503, detail="Web Push が設定されていません")
    await asyncio.to_thread(
        _upsert_push_subscription,
        email,
        body.endpoint,
        body.keys["p256dh"],
        body.keys["auth"],
    )
    return {"ok": True}


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(body: PushSubscribeBody, email: str = Depends(require_auth)):
    await asyncio.to_thread(_delete_push_subscription, body.endpoint)
    return {"ok": True}


# フロントエンドの静的ファイルを最後にマウント
if FRONTEND_DIR.exists():
    app.mount(
        "/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static"
    )
