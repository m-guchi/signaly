import json
import asyncio
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
CHANNELS_FILE = BASE_DIR / "channels.json"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# channel_name → list of subscriber queues
_subscribers: dict[str, list[asyncio.Queue]] = {}


def load_channels() -> dict[str, str]:
    """channel_id -> channel_name のマッピングを返す"""
    if not CHANNELS_FILE.exists():
        return {}
    return json.loads(CHANNELS_FILE.read_text(encoding="utf-8"))


def append_log(channel_name: str, entry: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    log_file = DATA_DIR / f"log_{channel_name}.json"
    logs: list = []
    if log_file.exists():
        try:
            logs = json.loads(log_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logs = []
    logs.append(entry)
    log_file.write_text(
        json.dumps(logs, ensure_ascii=False, indent=2), encoding="utf-8"
    )


app = FastAPI(title="Signaly")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class WebhookPayload(BaseModel):
    message: str
    title: str = ""
    level: str = "info"  # info | warning | error


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
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    append_log(channel_name, entry)

    # SSE 購読者に配信
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

    log_file = DATA_DIR / f"log_{channel_name}.json"
    if not log_file.exists():
        return {"logs": []}

    logs = json.loads(log_file.read_text(encoding="utf-8"))
    return {"logs": logs[-limit:]}


@app.get("/api/stream/{channel_name}")
async def stream_events(channel_name: str, request: Request):
    channels = load_channels()
    if channel_name not in channels.values():
        raise HTTPException(status_code=404, detail="Channel not found")

    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.setdefault(channel_name, []).append(queue)

    async def generate() -> AsyncIterator[str]:
        try:
            # 接続確認用の初期イベント
            yield "event: ping\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # keep-alive
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


# フロントエンドの静的ファイルを最後にマウント（API ルートより後に配置）
if FRONTEND_DIR.exists():
    app.mount(
        "/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static"
    )
