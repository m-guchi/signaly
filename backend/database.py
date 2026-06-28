import os

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session

_DB_USER = os.environ.get("DB_USER", "user")
_DB_PASSWORD = os.environ.get("DB_PASSWORD", "password")
_DB_HOST = os.environ.get("DB_HOST", "localhost")
_DB_PORT = os.environ.get("DB_PORT", "3306")
_DB_NAME = os.environ["DB_NAME"]

engine = create_engine(
    f"mysql+pymysql://{_DB_USER}:{_DB_PASSWORD}@{_DB_HOST}:{_DB_PORT}/{_DB_NAME}?charset=utf8mb4",
    pool_pre_ping=True,
)


class Base(DeclarativeBase):
    pass


class ChannelGroup(Base):
    __tablename__ = "channel_groups"

    id = Column(String(36), primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class Channel(Base):
    __tablename__ = "channels"

    id = Column(String(36), primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    group_id = Column(
        String(36),
        ForeignKey("channel_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sort_order = Column(Integer, nullable=False, default=0)
    webhook_secret_hash = Column(String(64), nullable=True)
    webhook_secret_enc = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String(36), primary_key=True)
    email = Column(String(255), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    key_hash = Column(String(64), nullable=False, unique=True)
    key_prefix = Column(String(16), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String(36), primary_key=True)
    channel = Column(String(100), nullable=False, index=True)
    title = Column(String(500), nullable=False, default="")
    message = Column(Text, nullable=False)
    level = Column(String(20), nullable=False, default="info")
    timestamp = Column(DateTime(timezone=True), nullable=False)
    fields = Column(Text, nullable=True)   # JSON array [{name, value, inline}]
    color = Column(String(20), nullable=True)  # CSS hex color e.g. #57f287


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(String(36), primary_key=True)
    email = Column(String(255), nullable=False, index=True)
    endpoint_hash = Column(String(64), nullable=False, unique=True)
    endpoint = Column(Text, nullable=False)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


def get_session() -> Session:
    return Session(engine)


def _migrate_add_columns() -> None:
    notification_columns = [
        "fields TEXT NULL",
        "color VARCHAR(20) NULL",
    ]
    channel_columns = [
        "webhook_secret_hash VARCHAR(64) NULL",
        "webhook_secret_enc TEXT NULL",
        "group_id VARCHAR(36) NULL",
        "sort_order INT NOT NULL DEFAULT 0",
    ]
    with engine.connect() as conn:
        for col_def in notification_columns:
            try:
                conn.execute(text(f"ALTER TABLE notifications ADD COLUMN {col_def}"))
                conn.commit()
            except Exception:
                pass  # column already exists
        for col_def in channel_columns:
            try:
                conn.execute(text(f"ALTER TABLE channels ADD COLUMN {col_def}"))
                conn.commit()
            except Exception:
                pass  # column already exists


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns()
