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
    terminos_aceptados = Column(Boolean, default=False)
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

    # Datos del RUC (consulta pública SUNAT / apis.net.pe)
    estado_ruc = Column(String(40))            # ACTIVO | BAJA DE OFICIO | ...
    condicion = Column(String(40))             # HABIDO | NO HABIDO
    tipo_contrib = Column(String(120))
    actividad_economica = Column(String(300))
    direccion = Column(String(400))
    ubicacion = Column(String(200))            # distrito, provincia, departamento
    padrones = Column(String(300))
    ruc_sync_at = Column(DateTime)

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
    # Recordatorios de vencimientos (Agenda Tributaria)
    recordatorios_activo = Column(Boolean, default=False)
    recordatorio_dias = Column(String(40), default="7,3,1,0")   # offsets de días
    recordatorio_wsp = Column(Boolean, default=True)
    recordatorio_email = Column(Boolean, default=False)
    recordatorio_email_dest = Column(String(200))
    updated_at = Column(DateTime, default=datetime.utcnow)


class RecordatorioLog(Base):
    """Evita reenviar el mismo recordatorio (dedup por obligación + offset de días)."""
    __tablename__ = "recordatorio_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    obligacion_id = Column(Integer, index=True)
    dias_offset = Column(Integer)
    sent_at = Column(DateTime, default=datetime.utcnow)


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


class Obligacion(Base):
    """Obligación tributaria — entidad central de la Agenda Tributaria Inteligente."""
    __tablename__ = "obligaciones"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    empresa_id = Column(Integer, ForeignKey("empresas.id"), index=True, nullable=True)
    clave = Column(String(120), unique=True, index=True)   # idempotencia auto-generadas

    tipo = Column(String(40), default="otro")              # declaracion_mensual | sire | detraccion | otro
    titulo = Column(String(300))
    descripcion = Column(Text)
    periodo = Column(String(40))                           # "Enero 2026"
    fecha_vencimiento = Column(DateTime, index=True)
    estado = Column(String(30), default="pendiente")       # ver ESTADOS en obligaciones.py
    prioridad = Column(String(20), default="media")        # alta | media | baja
    responsable = Column(String(120))
    monto = Column(String(40))                             # opcional, texto libre por ahora
    origen = Column(String(30), default="manual")          # auto_cronograma | manual | ia_documento

    observaciones = Column(Text)        # notas libres (autoguardado)
    checklist = Column(Text)            # JSON: [{"texto":..,"done":bool}]
    # Recordatorio propio de esta obligación (si recordatorio_dias != "", anula el global)
    recordatorio_dias = Column(String(40), default="")   # ej "1" o "3,1,0"
    recordatorio_wsp = Column(Boolean, default=True)
    recordatorio_email = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)


class ObligacionEvento(Base):
    """Comentarios, actividad (historial) y archivos de una obligación (página Notion)."""
    __tablename__ = "obligacion_eventos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    obligacion_id = Column(Integer, ForeignKey("obligaciones.id"), index=True, nullable=False)
    tipo = Column(String(20))           # comentario | actividad | archivo
    texto = Column(Text)
    autor = Column(String(120))
    archivo_nombre = Column(String(300))
    archivo_path = Column(String(500))
    created_at = Column(DateTime, default=datetime.utcnow)


class Cronograma(Base):
    """Cache del cronograma oficial SUNAT por (año, último dígito de RUC)."""
    __tablename__ = "cronogramas"

    id = Column(Integer, primary_key=True, autoincrement=True)
    anio = Column(Integer, index=True)
    ultimo_digito = Column(String(1), index=True)
    periodo_mes = Column(Integer)        # 1..12
    fecha_venc = Column(DateTime)        # vencimiento de la declaración
    created_at = Column(DateTime, default=datetime.utcnow)


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
        tables = insp.get_table_names()
        with engine.begin() as conn:
            if "users" in tables:
                ucols = {c["name"] for c in insp.get_columns("users")}
                if "terminos_aceptados" not in ucols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN terminos_aceptados BOOLEAN DEFAULT 0"))
            if "notifications" in tables:
                cols = {c["name"] for c in insp.get_columns("notifications")}
                if "empresa_id" not in cols:
                    conn.execute(text("ALTER TABLE notifications ADD COLUMN empresa_id INTEGER"))
                if "category" not in cols:
                    conn.execute(text("ALTER TABLE notifications ADD COLUMN category VARCHAR(120)"))
            if "empresas" in tables:
                ecols = {c["name"] for c in insp.get_columns("empresas")}
                nuevas = {
                    "estado_ruc": "VARCHAR(40)", "condicion": "VARCHAR(40)",
                    "tipo_contrib": "VARCHAR(120)", "actividad_economica": "VARCHAR(300)",
                    "direccion": "VARCHAR(400)", "ubicacion": "VARCHAR(200)",
                    "padrones": "VARCHAR(300)", "ruc_sync_at": "DATETIME",
                }
                for col, tipo in nuevas.items():
                    if col not in ecols:
                        conn.execute(text(f"ALTER TABLE empresas ADD COLUMN {col} {tipo}"))
            if "obligaciones" in tables:
                ocols = {c["name"] for c in insp.get_columns("obligaciones")}
                onuevas = {
                    "observaciones": "TEXT", "checklist": "TEXT",
                    "recordatorio_dias": "VARCHAR(40) DEFAULT ''",
                    "recordatorio_wsp": "BOOLEAN DEFAULT 1",
                    "recordatorio_email": "BOOLEAN DEFAULT 0",
                }
                for col, tipo in onuevas.items():
                    if col not in ocols:
                        conn.execute(text(f"ALTER TABLE obligaciones ADD COLUMN {col} {tipo}"))
            if "configuraciones" in tables:
                ccols = {c["name"] for c in insp.get_columns("configuraciones")}
                cnuevas = {
                    "recordatorios_activo": "BOOLEAN DEFAULT 0",
                    "recordatorio_dias": "VARCHAR(40) DEFAULT '7,3,1,0'",
                    "recordatorio_wsp": "BOOLEAN DEFAULT 1",
                    "recordatorio_email": "BOOLEAN DEFAULT 0",
                    "recordatorio_email_dest": "VARCHAR(200)",
                }
                for col, tipo in cnuevas.items():
                    if col not in ccols:
                        conn.execute(text(f"ALTER TABLE configuraciones ADD COLUMN {col} {tipo}"))
    except Exception:
        pass
