from sqlalchemy import (
    create_engine, Column, String, DateTime, Boolean, Text, Integer, ForeignKey
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sunat_bot.db")

# PostgreSQL necesita pool settings distintos a SQLite
_is_sqlite = DATABASE_URL.startswith("sqlite")
if _is_sqlite:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=300,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    """Cuenta de usuario de la plataforma Dashbot (NO es SUNAT)."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(100))
    apellido = Column(String(100))
    username = Column(String(80), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    plan = Column(String(50), default="free")
    max_empresas = Column(Integer, default=10)
    created_at = Column(DateTime, default=datetime.utcnow)

    empresas = relationship("Empresa", back_populates="user", cascade="all, delete-orphan")


class Empresa(Base):
    """Empresa registrada por un usuario. Guarda credenciales SOL CIFRADAS."""
    __tablename__ = "empresas"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    ruc = Column(String(11), index=True, nullable=False)
    razon_social = Column(String(300))
    alias = Column(String(150))
    sol_usuario = Column(String(100))
    sol_password_enc = Column(Text)  # cifrado con Fernet, nunca en texto plano
    estado = Column(String(50), default="pendiente")  # pendiente | activa | error
    last_login = Column(DateTime)
    last_sync = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="empresas")


class Programacion(Base):
    """Configuración de extracción automática programada (una por usuario)."""
    __tablename__ = "programaciones"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, unique=True, nullable=False)
    activo = Column(Boolean, default=False)
    frecuencia = Column(String(30), default="cada_x_horas")  # cada_x_horas | diario
    hora_inicio = Column(String(5), default="08:00")          # "HH:MM"
    repetir_cada = Column(Integer, default=6)                  # horas
    zona_horaria = Column(String(50), default="America/Lima")
    correo_envio = Column(String(200))
    fuente_sol = Column(Boolean, default=True)
    fuente_sunafil = Column(Boolean, default=False)
    last_run = Column(DateTime)
    next_run = Column(DateTime)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Configuracion(Base):
    """Configuración del usuario (alertas WhatsApp, preferencias). Una por usuario."""
    __tablename__ = "configuraciones"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, unique=True, nullable=False)
    whatsapp_activo = Column(Boolean, default=False)
    whatsapp_numero = Column(String(25))           # con código país, ej +51987654321
    whatsapp_apikey = Column(String(120))          # API key de CallMeBot
    whatsapp_nivel = Column(String(20), default="urgentes")  # urgentes | todas
    updated_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True)
    empresa_id = Column(Integer, ForeignKey("empresas.id"), index=True, nullable=True)
    ruc = Column(String(11), index=True)
    subject = Column(String(500))
    sender = Column(String(200))
    date_received = Column(DateTime)
    reference_number = Column(String(100))
    status = Column(String(50), default="nuevo")
    body_text = Column(Text)
    summary = Column(Text)
    category = Column(String(120))
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
    empresa_id = Column(Integer, nullable=True)
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
    # Migración ligera: agregar columnas nuevas si la tabla notifications ya existía
    _migrate_columns()


def _migrate_columns():
    """Agrega columnas nuevas a tablas existentes (SQLite simple migration)."""
    from sqlalchemy import inspect, text
    try:
        insp = inspect(engine)
        if "notifications" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("notifications")}
            with engine.begin() as conn:
                if "empresa_id" not in cols:
                    conn.execute(text("ALTER TABLE notifications ADD COLUMN empresa_id INTEGER"))
                if "category" not in cols:
                    conn.execute(text("ALTER TABLE notifications ADD COLUMN category VARCHAR(120)"))
    except Exception:
        pass
