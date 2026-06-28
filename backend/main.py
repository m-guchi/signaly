import json
import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import Notification, get_session, init_db

BASE_DIR = Path(__file__).parent
CHANNELS_FILE = BASE_DIR / "channels.json"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# channel_name → list of subscriber queues
_subscribers: Dict[str, List[asyncio.Queue]] = {}


def load_channels() -> Dict[str, str]:
    """channel_id -> channel_name のマッピングを返す"""
    if not CHANNELS_FILE.exists():
        return {}
    return json.loads(CHANNELS_FILE.read_text(encoding="utf-8"))


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


class WebhookPayload(BaseModel):
    message: str = ""
    title: str = ""
    level: str = "info"  # info | warning | error
    color: Optional[str] = None  # CSS hex e.g. #57f287
    fields: Optional[List[dict]] = None  # [{name, value, inline}]


@app.post("/webhook/{channel_id}")
async def receive_webhook(channel_id: str, payload: WebhookPayload):
    channels = load_channels()
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

    return {"ok": True, "id": entry["id"]}


@app.get("/api/channels")
async def get_channels():
    channels = load_channels()
    return {"channels": sorted(set(channels.values()))}


@app.get("/api/history/{channel_name}")
async def get_history(channel_name: str, limit: int = 200):
    channels = load_channels()
    if channel_name not in channels.values():
        raise HTTPException(status_code=404, detail="Channel not found")

    logs = await asyncio.to_thread(_fetch_history, channel_name, limit)
    return {"logs": logs}


@app.get("/api/stream/{channel_name}")
async def stream_events(channel_name: str, request: Request):
    channels = load_channels()
    if channel_name not in channels.values():
        raise HTTPException(status_code=404, detail="Channel not found")

    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.setdefault(channel_name, []).append(queue)

    async def generate() -> AsyncIterator[str]:
        try:
            yield "event: ping\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
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


if FRONTEND_DIR.exists():
    app.mount(
        "/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static"
    )
