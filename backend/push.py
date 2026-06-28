"""Web Push 送信（VAPID）"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cryptography.hazmat.primitives.serialization import load_pem_private_key
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from database import PushSubscription, get_session
from notification_prefs import resolve_notification_enabled

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


def _plain_text(text: str) -> str:
    """プッシュ通知用に Markdown を除去する。"""
    cleaned = text.replace(":rocket:", "🚀")
    cleaned = re.sub(r"\*\*(.+?)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"__(.+?)__", r"\1", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1", cleaned)
    return cleaned


def _notification_body(entry: Dict[str, Any]) -> str:
    fields = entry.get("fields") or []
    if fields:
        parts = [
            f"{_plain_text(str(f.get('name', '')))}: {_plain_text(str(f.get('value', '')))}"
            for f in fields
        ]
        return "\n".join(parts)
    if entry.get("message"):
        return _plain_text(entry["message"])
    return ""


def _build_payload(entry: Dict[str, Any]) -> str:
    channel = entry.get("channel", "")
    return json.dumps(
        {
            "title": entry.get("title") or f"#{channel}",
            "body": _notification_body(entry),
            "id": entry.get("id"),
            "channel": channel,
            "url": f"./?channel={channel}&src=push" if channel else "./",
        },
        ensure_ascii=False,
    )


def _fetch_subscriptions() -> List[Dict[str, str]]:
    with get_session() as session:
        rows = session.query(PushSubscription).all()
        return [
            {
                "id": row.id,
                "email": row.email,
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


def _fetch_subscriptions_for_email(email: str) -> List[Dict[str, str]]:
    with get_session() as session:
        rows = session.query(PushSubscription).filter(PushSubscription.email == email).all()
        return [
            {
                "id": row.id,
                "email": row.email,
                "endpoint": row.endpoint,
                "p256dh": row.p256dh,
                "auth": row.auth,
            }
            for row in rows
        ]


def _build_test_payload() -> str:
    return json.dumps(
        {
            "title": "Signaly テスト通知",
            "body": "通知の受信確認用です。このまま届いていれば OK です。",
            "id": "signaly-test",
            "channel": "",
            "url": "./",
        },
        ensure_ascii=False,
    )


def _deliver_push_result(sub: Dict[str, str], payload: str, vapid: Vapid02) -> Tuple[bool, Optional[int]]:
    subscription_info = {
        "endpoint": sub["endpoint"],
        "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
    }
    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=vapid,
            vapid_claims={"sub": VAPID_SUBJECT},
        )
        return True, None
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        body = (exc.response.text or "")[:200] if exc.response is not None else ""
        logger.warning(
            "Web Push failed (%s): %s — %s",
            status,
            sub["endpoint"][:60],
            body,
        )
        if status in (403, 404, 410):
            _delete_subscription(sub["id"])
        return False, status
    except Exception:
        logger.exception("Web Push error: %s", sub["endpoint"][:60])
        return False, None


def _deliver_push(sub: Dict[str, str], payload: str, vapid: Vapid02) -> bool:
    return _deliver_push_result(sub, payload, vapid)[0]


def send_test_push_to_user(email: str, endpoint: Optional[str] = None) -> Dict[str, Any]:
    """ログイン中ユーザーの登録端末へテスト Push を送る。"""
    if not push_configured():
        return {"sent": 0, "failed": 0, "error": "not_configured"}

    subs = _fetch_subscriptions_for_email(email)
    if endpoint:
        subs = [s for s in subs if s["endpoint"] == endpoint]
    if not subs:
        return {"sent": 0, "failed": 0, "error": "no_subscription"}

    payload = _build_test_payload()
    vapid = _load_vapid()
    sent = 0
    failed = 0
    removed = 0
    last_status: Optional[int] = None
    for sub in subs:
        ok, status = _deliver_push_result(sub, payload, vapid)
        if ok:
            sent += 1
        else:
            failed += 1
            last_status = status
            if status in (403, 404, 410):
                removed += 1
    result: Dict[str, Any] = {"sent": sent, "failed": failed}
    if removed:
        result["removed"] = removed
    if last_status is not None:
        result["last_status"] = last_status
    return result


def send_push_notifications(entry: Dict[str, Any]) -> None:
    """全登録端末に Web Push を送信する（webhook 受信時に呼ぶ）"""
    if not push_configured():
        return

    subs = _fetch_subscriptions()
    if not subs:
        return

    payload = _build_payload(entry)
    vapid = _load_vapid()

    channel_name = entry.get("channel", "")

    for sub in subs:
        if channel_name and not resolve_notification_enabled(sub["email"], channel_name):
            continue
        if not _deliver_push(sub, payload, vapid):
            pass
