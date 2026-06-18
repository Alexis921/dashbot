from sqlalchemy import create_engine, Column, String, DateTime, Boolean, Text, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sunat_bot.db")

# PostgreSQL necesita pool settings distintos a SQLite
_is_sqlite = DATABASE_URL.startswith("sqlite")
if _is_sqlite:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # Neon / Supabase / cualquier Postgres
    engine = create_engine(
        DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=300,
    )
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True)
    ruc = Column(String(11), index=True)
    subject = Column(String(500))
    sender = Column(String(200))
    date_received = Column(DateTime)
    reference_number = Column(String(100))
    status = Column(String(50), default="nuevo")
    body_text = Column(Text)
    summary = Column(Text)
    has_attachment = Column(Boolean, default=False)
    attachment_name = Column(String(300))
    attachment_data = Column(Text)  # base64
    is_urgent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    synced_at = Column(DateTime, default=datetime.utcnow)


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ruc = Column(String(11))
    synced_at = Column(DateTime, default=datetime.utcnow)
    count_new = Column(Integer, default=0)
    status = Column(String(50))
    error_msg = Column(Text)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
