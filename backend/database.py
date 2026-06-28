import os

from sqlalchemy import Column, DateTime, String, Text, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session

_DB_USER = os.environ.get("DB_USER", "user")
_DB_PASSWORD = os.environ.get("DB_PASSWORD", "password")
_DB_HOST = os.environ.get("DB_HOST", "localhost")
_DB_PORT = os.environ.get("DB_PORT", "3306")
_DB_NAME = os.environ["DB_NAME"]

engine = create_engine(
    f"mysql+pymysql://{_DB_USER}:{_DB_PASSWORD}@{_DB_HOST}:{_DB_PORT}/{_DB_NAME}",
    pool_pre_ping=True,
)


class Base(DeclarativeBase):
    pass


class Channel(Base):
    __tablename__ = "channels"

    id = Column(String(36), primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


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


def get_session() -> Session:
    return Session(engine)


def _migrate_add_columns() -> None:
    new_columns = [
        "fields TEXT NULL",
        "color VARCHAR(20) NULL",
    ]
    with engine.connect() as conn:
        for col_def in new_columns:
            try:
                conn.execute(text(f"ALTER TABLE notifications ADD COLUMN {col_def}"))
                conn.commit()
            except Exception:
                pass  # column already exists


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns()
