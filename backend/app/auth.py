"""
Autenticación de usuarios Dashbot + cifrado de credenciales SOL.
- Contraseñas de usuario: hash bcrypt (irreversible)
- Contraseñas SOL de empresas: cifrado Fernet (reversible, para poder loguear en SUNAT)
"""
import os
import base64
import hashlib
from datetime import datetime, timedelta
from typing import Optional

from passlib.context import CryptContext
from jose import jwt, JWTError
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.database import get_db, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("SECRET_KEY", "dashbot2024xsecret")
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30


# ── Hash de contraseñas de usuario ────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


# ── JWT ───────────────────────────────────────────────────────────────────
def create_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": datetime.utcnow() + timedelta(days=TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Dependency: valida el JWT del header Authorization: Bearer <token>."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "No autenticado. Inicia sesión.")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Sesión expirada. Vuelve a iniciar sesión.")
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise HTTPException(401, "Usuario no encontrado.")
    return user


# ── Cifrado de credenciales SOL (Fernet) ──────────────────────────────────
def _get_fernet() -> Fernet:
    key = os.getenv("FERNET_KEY")
    if not key:
        # Derivar una clave válida de 32 bytes desde SECRET_KEY
        key = base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest())
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _get_fernet().decrypt(token.encode()).decode()
