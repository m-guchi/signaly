"""Web Push 送信（VAPID）"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List

from cryptography.hazmat.primitives.serialization import load_pem_private_key
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from database import PushSubscription, get_session

logger = logging.getLogger(__name__)

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PRIVATE_KEY_FILE = os.getenv("VAPID_PRIVATE_KEY_FILE", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "")


def validate_push_config() -> None:
    """起動時に VAPID 鍵が読めるか確認する"""
    _load_vapid()


def push_configured() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_SUBJECT and (VAPID_PRIVATE_KEY or VAPID_PRIVATE_KEY_FILE))


def _pem_bytes() -> bytes:
    if VAPID_PRIVATE_KEY_FILE:
        path = Path(VAPID_PRIVATE_KEY_FILE)
        if path.is_file():
            return path.read_bytes()
    raw = (VAPID_PRIVATE_KEY or "").strip().strip("'").strip('"').replace("\\n", "\n")
    if not raw:
        raise ValueError("VAPID private key is not configured")
    return raw.encode()


def _load_vapid() -> Vapid02:
    # py_vapid.from_pem は標準 PEM を正しく読めないため cryptography で読み込む
    private_key = load_pem_private_key(_pem_bytes(), password=None)
    return Vapid02(private_key=private_key)


def _notification_body(entry: Dict[str, Any]) -> str:
    if entry.get("message"):
        return entry["message"]
    fields = entry.get("fields") or []
    parts = [f"{f.get('name', '')}: {f.get('value', '')}" for f in fields[:3]]
    return "\n".join(parts) if parts else ""


def _build_payload(entry: Dict[str, Any]) -> str:
    channel = entry.get("channel", "")
    return json.dumps(
        {
            "title": entry.get("title") or f"#{channel}",
            "body": _notification_body(entry),
            "id": entry.get("id"),
            "channel": channel,
            "url": f"./?channel={channel}" if channel else "./",
        },
        ensure_ascii=False,
    )


def _fetch_subscriptions() -> List[Dict[str, str]]:
    with get_session() as session:
        rows = session.query(PushSubscription).all()
        return [
            {
                "id": row.id,
                "endpoint": row.endpoint,
                "p256dh": row.p256dh,
                "auth": row.auth,
            }
            for row in rows
        ]


def _delete_subscription(sub_id: str) -> None:
    with get_session() as session:
        row = session.get(PushSubscription, sub_id)
        if row:
            session.delete(row)
            session.commit()


def send_push_notifications(entry: Dict[str, Any]) -> None:
    """全登録端末に Web Push を送信する（webhook 受信時に呼ぶ）"""
    if not push_configured():
        return

    subs = _fetch_subscriptions()
    if not subs:
        return

    payload = _build_payload(entry)
    vapid = _load_vapid()
    claims = {"sub": VAPID_SUBJECT}

    for sub in subs:
        subscription_info = {
            "endpoint": sub["endpoint"],
            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=vapid,
                vapid_claims=claims,
            )
        except WebPushException as exc:
            status = exc.response.status_code if exc.response is not None else None
            logger.warning("Web Push failed (%s): %s", status, sub["endpoint"][:60])
            if status in (403, 404, 410):
                _delete_subscription(sub["id"])
        except Exception:
            logger.exception("Web Push error: %s", sub["endpoint"][:60])
