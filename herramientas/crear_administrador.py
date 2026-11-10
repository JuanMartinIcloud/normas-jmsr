"""Crea el primer usuario administrador de la web (si ese usuario todavia no existe).

La contraseña la elige el dueño y la guarda como secreto ADMIN_CLAVE_INICIAL en GitHub: no pasa por el
registro de la tarea ni por el chat. Se cifra igual que en la web (scrypt, ver web/lib/auth.js).
"""
import hashlib
import os
import re
import secrets
import sys

import psycopg2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import neon_urls  # noqa: E402

neon_urls.completar_entorno()
usuario = os.environ["USUARIO"].strip().lower()
nombre = os.getenv("NOMBRE", "").strip() or usuario
clave = os.getenv("ADMIN_CLAVE_INICIAL", "")
if not re.fullmatch(r"[a-z0-9._@-]{3,60}", usuario):
    raise SystemExit("::error::El usuario debe tener de 3 a 60 letras, numeros, punto, guion o @.")
if len(clave) < 8:
    raise SystemExit("::error::Falta el secreto ADMIN_CLAVE_INICIAL (al menos 8 caracteres).")
sal = secrets.token_bytes(16)
h = hashlib.scrypt(clave.encode(), salt=sal, n=16384, r=8, p=1, dklen=64)
c = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=60)
cur = c.cursor()
cur.execute(open(os.path.join(os.path.dirname(__file__), "..", "schema.sql"), encoding="utf-8").read())
cur.execute("""INSERT INTO usuarios (usuario, nombre, clave_hash, rol) VALUES (%s, %s, %s, 'admin')
               ON CONFLICT (usuario) DO NOTHING""", (usuario, nombre, f"scrypt${sal.hex()}${h.hex()}"))
creado = cur.rowcount
c.commit()
print(f"Usuario administrador «{usuario}» creado." if creado else f"El usuario «{usuario}» ya existia: no se cambio nada.")
