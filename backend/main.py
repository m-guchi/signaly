import json
import asyncio
import hashlib
import logging
import os
import secrets
import urllib.parse
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
from itsdangerous import BadData

import auth
from database import ApiKey, Channel, Notification, PushSubscription, get_session, init_db
from push import push_configured, send_push_notifications, validate_push_config
from webhook import parse_webhook_payload

BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# channel_name → list of subscriber queues
_subscribers: Dict[str, List[asyncio.Queue]] = {}

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")


# ── DB helpers（threadpool で呼ぶ）────────────────────────────────────────────

def _fetch_channels() -> Dict[str, str]:
    """channel_id -> channel_name"""
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


def _update_channel(channel_id: str, name: str) -> Optional[Dict[str, str]]:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        row = session.query(Channel).filter(Channel.id == channel_id).first()
        if not row:
            return None
        old_name = row.name
        if old_name != name and session.query(Channel).filter(Channel.name == name).first():
            raise ValueError("duplicate")
        row.name = name
        row.updated_at = now
        if old_name != name:
            session.query(Notification).filter(Notification.channel == old_name).update(
                {Notification.channel: name},
                synchronize_session=False,
            )
        session.commit()
    if old_name != name and old_name in _subscribers:
        _subscribers[name] = _subscribers.pop(old_name)
    return {"id": channel_id, "name": name}


def _delete_channel(channel_id: str) -> Optional[str]:
    with get_session() as session:
        row = session.query(Channel).filter(Channel.id == channel_id).first()
        if not row:
            return None
        name = row.name
        session.query(Notification).filter(Notification.channel == name).delete(
            synchronize_session=False,
        )
        session.delete(row)
        session.commit()
    _subscribers.pop(name, None)
    return name


def _resolve_api_key_email(key: str) -> Optional[str]:
    key_hash = auth.hash_secret(key)
    now = datetime.now(timezone.utc)
    with get_session() as session:
        row = session.query(ApiKey).filter(ApiKey.key_hash == key_hash).first()
        if not row:
            return None
        row.last_used_at = now
        session.commit()
        return row.email


def _create_api_key(email: str, name: str) -> dict:
    key = auth.generate_api_key()
    now = datetime.now(timezone.utc)
    key_id = str(uuid.uuid4())
    with get_session() as session:
        session.add(
            ApiKey(
                id=key_id,
                email=email,
                name=name,
                key_hash=auth.hash_secret(key),
                key_prefix=auth.api_key_prefix(key),
                created_at=now,
            )
        )
        session.commit()
    return {
        "id": key_id,
        "name": name,
        "key": key,
        "key_prefix": auth.api_key_prefix(key),
        "created_at": now.isoformat(),
    }


def _list_api_keys(email: str) -> List[dict]:
    with get_session() as session:
        rows = (
            session.query(ApiKey)
            .filter(ApiKey.email == email)
            .order_by(ApiKey.created_at.desc())
            .all()
        )
        return [
            {
                "id": r.id,
                "name": r.name,
                "key_prefix": r.key_prefix,
                "created_at": r.created_at.isoformat(),
                "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
            }
            for r in rows
        ]


def _delete_api_key(email: str, key_id: str) -> bool:
    with get_session() as session:
        row = session.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.email == email).first()
        if not row:
            return False
        session.delete(row)
        session.commit()
        return True


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
    auth.set_api_key_resolver(_resolve_api_key_email)
    if push_configured():
        try:
            await asyncio.to_thread(validate_push_config)
            logging.info("Web Push (VAPID) configured OK")
        except Exception:
            logging.exception("Web Push (VAPID) key load failed — push notifications disabled")
    yield


app = FastAPI(title="Signaly", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.get("/auth/login")
async def auth_login():
    if not auth.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth が設定されていません")

    state = secrets.token_urlsafe(16)
    signed_state = auth.sign_value(state)

    params = urllib.parse.urlencode({
        "client_id": auth.GOOGLE_CLIENT_ID,
        "redirect_uri": auth.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email",
        "state": state,
    })
    response = RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")
    response.set_cookie(auth.STATE_COOKIE, signed_state, httponly=True, samesite="lax", max_age=600)
    return response


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str, state: str):
    # state 検証（CSRF 対策）
    signed_state = request.cookies.get(auth.STATE_COOKIE)
    if not signed_state:
        raise HTTPException(status_code=400, detail="不正なリクエストです（state cookie なし）")
    try:
        expected_state = auth.load_signed_value(signed_state, max_age=600)
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
                "client_id": auth.GOOGLE_CLIENT_ID,
                "client_secret": auth.GOOGLE_CLIENT_SECRET,
                "redirect_uri": auth.GOOGLE_REDIRECT_URI,
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
    if not email or email not in auth.ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="このアカウントはアクセスが許可されていません")

    session_token = auth.sign_value(email)
    response = RedirectResponse(url=auth.APP_URL, status_code=302)
    response.set_cookie(
        auth.SESSION_COOKIE,
        session_token,
        max_age=auth.SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
    )
    response.delete_cookie(auth.STATE_COOKIE)
    return response


@app.get("/auth/me")
async def auth_me(request: Request):
    email = auth.get_session_email(request)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"email": email}


@app.post("/auth/logout")
async def auth_logout(response: Response):
    response.delete_cookie(auth.SESSION_COOKIE)
    return {"ok": True}


# ── Webhook（認証不要：外部サービスから叩く）──────────────────────────────────
# Discord Execute Webhook と同じ JSON 形式（content / embeds 等）を受け付ける。
# Signaly レガシー形式（message / title / level 等）も引き続き利用可能。


def _channel_item(request: Request, channel_id: str, name: str) -> dict:
    return {
        "id": channel_id,
        "name": name,
        "webhook_url": _webhook_url(request, channel_id),
    }


async def _read_webhook_body(request: Request) -> dict:
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        raw = form.get("payload_json")
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="payload_json が不正な JSON です") from exc
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="payload_json は JSON オブジェクトである必要があります")
        return data

    try:
        body = await request.body()
    except Exception:
        body = b""
    if not body.strip():
        return {}
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="リクエストボディが不正な JSON です") from exc
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="リクエストボディは JSON オブジェクトである必要があります")
    return data


@app.post("/webhook/{channel_id}")
async def receive_webhook(channel_id: str, request: Request):
    channels = await asyncio.to_thread(_fetch_channels)
    if channel_id not in channels:
        raise HTTPException(status_code=404, detail="Channel not found")

    raw = await _read_webhook_body(request)
    try:
        parsed = parse_webhook_payload(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    channel_name = channels[channel_id]
    entry = {
        "id": str(uuid.uuid4()),
        "channel": channel_name,
        "title": parsed["title"],
        "message": parsed["message"],
        "level": parsed["level"],
        "color": parsed["color"],
        "fields": parsed["fields"],
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
async def get_channels(request: Request, email: str = Depends(auth.require_auth)):
    channels = await asyncio.to_thread(_fetch_channels)
    items = [_channel_item(request, cid, name) for cid, name in channels.items()]
    items.sort(key=lambda c: c["name"])
    return {"channels": items}


@app.post("/api/channels")
async def create_channel(
    request: Request,
    body: CreateChannelRequest,
    email: str = Depends(auth.require_auth),
):
    try:
        created = await asyncio.to_thread(_create_channel, body.name)
    except ValueError:
        raise HTTPException(status_code=409, detail="同じ名前のチャンネルが既に存在します")

    return _channel_item(request, created["id"], created["name"])


@app.patch("/api/channels/{channel_id}")
async def update_channel(
    channel_id: str,
    request: Request,
    body: CreateChannelRequest,
    email: str = Depends(auth.require_auth),
):
    try:
        updated = await asyncio.to_thread(_update_channel, channel_id, body.name)
    except ValueError:
        raise HTTPException(status_code=409, detail="同じ名前のチャンネルが既に存在します")
    if not updated:
        raise HTTPException(status_code=404, detail="Channel not found")
    return _channel_item(request, updated["id"], updated["name"])


@app.delete("/api/channels/{channel_id}")
async def delete_channel(channel_id: str, email: str = Depends(auth.require_auth)):
    name = await asyncio.to_thread(_delete_channel, channel_id)
    if not name:
        raise HTTPException(status_code=404, detail="Channel not found")
    return {"ok": True, "name": name}


@app.get("/api/history/{channel_name}")
async def get_history(channel_name: str, limit: int = 200, email: str = Depends(auth.require_auth)):
    channels = await asyncio.to_thread(_fetch_channels)
    if channel_name not in channels.values():
        raise HTTPException(status_code=404, detail="Channel not found")

    logs = await asyncio.to_thread(_fetch_history, channel_name, limit)
    return {"logs": logs}


@app.get("/api/stream/{channel_name}")
async def stream_events(channel_name: str, request: Request, email: str = Depends(auth.require_auth)):
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
async def push_vapid_public_key(email: str = Depends(auth.require_auth)):
    if not push_configured():
        raise HTTPException(status_code=503, detail="Web Push が設定されていません")
    return {"publicKey": VAPID_PUBLIC_KEY}


@app.post("/api/push/subscribe")
async def push_subscribe(body: PushSubscribeBody, email: str = Depends(auth.require_auth)):
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
async def push_unsubscribe(body: PushSubscribeBody, email: str = Depends(auth.require_auth)):
    await asyncio.to_thread(_delete_push_subscription, body.endpoint)
    return {"ok": True}


# ── API キー ──────────────────────────────────────────────────────────────────

class CreateApiKeyRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("名前を入力してください")
        if len(v) > 100:
            raise ValueError("名前は100文字以内にしてください")
        return v


@app.get("/api/keys")
async def list_api_keys(email: str = Depends(auth.require_auth)):
    keys = await asyncio.to_thread(_list_api_keys, email)
    return {"keys": keys}


@app.post("/api/keys")
async def create_api_key(body: CreateApiKeyRequest, email: str = Depends(auth.require_auth)):
    created = await asyncio.to_thread(_create_api_key, email, body.name)
    return created


@app.delete("/api/keys/{key_id}")
async def delete_api_key(key_id: str, email: str = Depends(auth.require_auth)):
    deleted = await asyncio.to_thread(_delete_api_key, email, key_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="API キーが見つかりません")
    return {"ok": True}


# フロントエンドの静的ファイルを最後にマウント
if FRONTEND_DIR.exists():
    app.mount(
        "/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static"
    )
