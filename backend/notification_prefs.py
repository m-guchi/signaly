"""チャンネル・グループごとの通知設定（チャンネル > グループの優先順位）"""

from datetime import datetime, timezone
from typing import Dict, Optional

from sqlalchemy.orm import Session

from database import Channel, NotificationSetting, get_session

TARGET_CHANNEL = "channel"
TARGET_GROUP = "group"


def resolve_notification_enabled(email: str, channel_name: str) -> bool:
    """通知を送るべきか。チャンネル設定が優先、未設定ならグループ、どちらも未設定なら有効。"""
    with get_session() as session:
        channel = session.query(Channel).filter(Channel.name == channel_name).first()
        if not channel:
            return True
        return _resolve_for_channel(session, email, channel)


def _resolve_for_channel(session: Session, email: str, channel: Channel) -> bool:
    channel_row = (
        session.query(NotificationSetting)
        .filter(
            NotificationSetting.email == email,
            NotificationSetting.target_type == TARGET_CHANNEL,
            NotificationSetting.target_id == channel.id,
        )
        .first()
    )
    if channel_row is not None and channel_row.enabled is not None:
        return channel_row.enabled

    if channel.group_id:
        group_row = (
            session.query(NotificationSetting)
            .filter(
                NotificationSetting.email == email,
                NotificationSetting.target_type == TARGET_GROUP,
                NotificationSetting.target_id == channel.group_id,
            )
            .first()
        )
        if group_row is not None:
            return group_row.enabled

    return True


def get_notification_settings(email: str) -> Dict[str, Dict[str, Optional[bool]]]:
    with get_session() as session:
        rows = (
            session.query(NotificationSetting)
            .filter(NotificationSetting.email == email)
            .all()
        )
    channels: Dict[str, Optional[bool]] = {}
    groups: Dict[str, bool] = {}
    for row in rows:
        if row.target_type == TARGET_CHANNEL:
            channels[row.target_id] = row.enabled
        elif row.target_type == TARGET_GROUP and row.enabled is not None:
            groups[row.target_id] = row.enabled
    return {"channels": channels, "groups": groups}


def set_channel_notification_setting(
    email: str, channel_id: str, enabled: Optional[bool]
) -> None:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        if not session.query(Channel).filter(Channel.id == channel_id).first():
            raise ValueError("channel_not_found")

        row = (
            session.query(NotificationSetting)
            .filter(
                NotificationSetting.email == email,
                NotificationSetting.target_type == TARGET_CHANNEL,
                NotificationSetting.target_id == channel_id,
            )
            .first()
        )

        if enabled is None:
            if row:
                session.delete(row)
        elif row:
            row.enabled = enabled
            row.updated_at = now
        else:
            session.add(
                NotificationSetting(
                    email=email,
                    target_type=TARGET_CHANNEL,
                    target_id=channel_id,
                    enabled=enabled,
                    updated_at=now,
                )
            )
        session.commit()


def set_group_notification_setting(email: str, group_id: str, enabled: bool) -> None:
    from database import ChannelGroup

    now = datetime.now(timezone.utc)
    with get_session() as session:
        if not session.query(ChannelGroup).filter(ChannelGroup.id == group_id).first():
            raise ValueError("group_not_found")

        row = (
            session.query(NotificationSetting)
            .filter(
                NotificationSetting.email == email,
                NotificationSetting.target_type == TARGET_GROUP,
                NotificationSetting.target_id == group_id,
            )
            .first()
        )

        if enabled and row is None:
            return

        if enabled and row is not None:
            session.delete(row)
        elif not enabled:
            if row:
                row.enabled = False
                row.updated_at = now
            else:
                session.add(
                    NotificationSetting(
                        email=email,
                        target_type=TARGET_GROUP,
                        target_id=group_id,
                        enabled=False,
                        updated_at=now,
                    )
                )
        session.commit()


def delete_settings_for_target(target_type: str, target_id: str) -> None:
    with get_session() as session:
        session.query(NotificationSetting).filter(
            NotificationSetting.target_type == target_type,
            NotificationSetting.target_id == target_id,
        ).delete(synchronize_session=False)
        session.commit()
