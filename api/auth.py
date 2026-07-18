import os
import secrets
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import bcrypt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from database import SessionLocal, AuthConfigRow

SECURITY = HTTPBearer(auto_error=False)
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30


def _get_config_value(key: str) -> str | None:
    db = SessionLocal()
    try:
        row = db.query(AuthConfigRow).filter(AuthConfigRow.key == key).first()
        return row.value if row else None
    finally:
        db.close()


def _set_config_value(key: str, value: str):
    db = SessionLocal()
    try:
        row = db.query(AuthConfigRow).filter(AuthConfigRow.key == key).first()
        if row:
            row.value = value
        else:
            db.add(AuthConfigRow(key=key, value=value))
        db.commit()
    finally:
        db.close()


def _get_jwt_secret() -> str:
    secret = _get_config_value("jwt_secret")
    if not secret:
        secret = secrets.token_urlsafe(32)
        _set_config_value("jwt_secret", secret)
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token() -> str:
    secret = _get_jwt_secret()
    expire = datetime.now(ZoneInfo("America/Sao_Paulo")) + timedelta(days=TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": "admin", "exp": expire}, secret, algorithm=ALGORITHM)


def verify_token(token: str) -> bool:
    try:
        secret = _get_jwt_secret()
        jwt.decode(token, secret, algorithms=[ALGORITHM])
        return True
    except JWTError:
        return False


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(SECURITY)):
    if credentials is None:
        raise HTTPException(status_code=401, detail="Token de autenticação necessário")
    if not verify_token(credentials.credentials):
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
    return "admin"


def ensure_default_password():
    hashed = _get_config_value("hashed_password")
    if not hashed:
        default = os.environ.get("AUTH_PASSWORD", "admin")
        hashed = hash_password(default)
        _set_config_value("hashed_password", hashed)
        print(f"[Auth] Senha padrão definida. Use 'PUT /api/auth/set-password' para alterá-la.")
