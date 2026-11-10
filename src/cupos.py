"""Cupo mensual de TRANSFERENCIA de cada base de Neon (datos que salen de la base: 5 GB al mes gratis).

    python src/cupos.py            # mide cada base y guarda el resultado (4 veces al dia, flujo "Cupos de Neon")

Reglas:
- Base de texto que llega a 4 GB en el mes: no se le agrega nada mas; lo nuevo va a la siguiente.
- Base principal que llega a 4 GB: se detienen las tareas no indispensables (lectura de escaneados,
  analisis de meses anteriores, revision completa de proyectos). La web y las tareas diarias siguen.
- Base principal que llega a 4,6 GB (emergencia): se detienen todas las tareas automaticas que la leen;
  lo que queda se reserva para la web.
- Neon renueva el cupo el dia 1 de cada mes (00:00 hora universal = 7:00 p. m. del dia anterior en Lima).
  Una medicion de un mes anterior no cuenta: asi las tareas se reanudan solas aunque la medicion se retrase.

La medicion usa la API de Neon (secreto NEON_API_KEY) y no despierta las bases: el identificador de cada
proyecto de Neon se anota la primera vez y despues se reutiliza.
"""
import os
import time
from urllib.parse import urlparse

import psycopg2
import requests

import bases

GB = 10 ** 9
TOPE_BYTES = 4 * GB                  # Neon cuenta GB de 1000 millones de bytes
EMERGENCIA_BYTES = int(4.6 * GB)
API = "https://console.neon.tech/api/v2"
SQL = """CREATE TABLE IF NOT EXISTS cupos (
    host        TEXT PRIMARY KEY,           -- servidor de la base (de su cadena de conexion)
    base        TEXT NOT NULL,              -- nombre en el sistema (principal, texto 2, ...)
    proyecto    TEXT,                       -- nombre del proyecto en Neon
    transferido BIGINT NOT NULL DEFAULT 0,  -- bytes transferidos en el periodo actual
    periodo     TIMESTAMPTZ,                -- inicio del periodo de Neon
    actualizado TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE cupos ADD COLUMN IF NOT EXISTS proyecto_id TEXT;   -- identificador del proyecto en Neon"""


def host(url: str) -> str:
    """Servidor de la base, sin el sufijo "-pooler" (la misma base con o sin pool de conexiones)."""
    h = (urlparse(url).hostname or "").lower()
    return h.replace("-pooler", "")


def bases_del_sistema():
    salida = [("principal", bases.url_principal())] + [(f"texto {i}", u) for i, u in bases.bases_texto()]
    return [(n, u) for n, u in salida if u]


def _leer():
    """{host: bytes transferidos} del periodo actual de Neon (vacio si no hay medicion de este mes)."""
    url = bases.control_url()
    if not url:
        return {}
    try:
        c = psycopg2.connect(url, connect_timeout=60)
        try:
            with c.cursor() as cur:
                cur.execute("SELECT to_regclass('public.cupos') IS NOT NULL")
                if not cur.fetchone()[0]:
                    return {}
                cur.execute("""SELECT host, transferido FROM cupos
                               WHERE periodo >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'""")
                return dict(cur.fetchall())
        finally:
            c.close()
    except psycopg2.Error as e:
        print(f"  (no se pudo leer el cupo de transferencia: {str(e)[:120]})")
        return {}


_cache = {"t": 0.0, "datos": {}}


def medidos():
    if time.time() - _cache["t"] > 600:
        _cache["datos"], _cache["t"] = _leer(), time.time()
    return _cache["datos"]


def agotada(url: str) -> bool:
    """True si esa base ya llego al tope de 4 GB de transferencia este mes."""
    return medidos().get(host(url), 0) >= TOPE_BYTES


def principal_agotada() -> bool:
    url = bases.url_principal()
    if url and agotada(url):
        print("La base principal llego a 4 GB de transferencia este mes: esta tarea no indispensable "
              "se detiene hasta que se renueve el cupo.")
        return True
    return False


def principal_en_emergencia() -> bool:
    url = bases.url_principal()
    if url and medidos().get(host(url), 0) >= EMERGENCIA_BYTES:
        print("::warning title=Cupo de la base principal::La base principal llego a 4,6 GB de transferencia este mes. "
              "Las tareas automaticas se detienen hasta que se renueve el cupo (dia 1, 7:00 p. m. del dia anterior "
              "en Lima); lo que queda se reserva para la web. Lo pendiente se completa solo despues.")
        return True
    return False


def actualizar():
    clave = os.getenv("NEON_API_KEY", "").strip()
    if not clave:
        print("::warning title=Cupos::Falta el secreto NEON_API_KEY: no se puede medir la transferencia.")
        return
    ctl = bases.control_url()
    if not ctl:
        print("::warning title=Cupos::Falta el secreto TEXTOS_URL_2 (base de control).")
        return
    c = psycopg2.connect(ctl, connect_timeout=60)
    with c.cursor() as cur:
        cur.execute(SQL)
        cur.execute("SELECT host, proyecto_id FROM cupos WHERE proyecto_id IS NOT NULL")
        conocidos = dict(cur.fetchall())
    c.commit()
    c.close()
    h = {"Authorization": f"Bearer {clave}", "Accept": "application/json"}
    filas = []
    for nombre, url in bases_del_sistema():
        try:
            pid = conocidos.get(host(url))
            if not pid:
                # Solo la primera vez: se pregunta a la base su identificador de proyecto
                b = psycopg2.connect(url, connect_timeout=60)
                with b.cursor() as cur:
                    cur.execute("SELECT current_setting('neon.project_id')")
                    pid = cur.fetchone()[0]
                b.close()
            r = requests.get(f"{API}/projects/{pid}", headers=h, timeout=60)
            r.raise_for_status()
            p = r.json().get("project", {})
        except Exception as e:  # noqa: BLE001
            print(f"::warning title=Cupo {nombre}::No se pudo medir: {str(e)[:200]}")
            continue
        b_ = int(p.get("data_transfer_bytes") or 0)
        filas.append((host(url), nombre, p.get("name"), b_, p.get("consumption_period_start"), pid))
        print(f"{nombre} ({p.get('name')}): {b_ / GB:.2f} GB transferidos este mes")
        if b_ >= TOPE_BYTES * 0.8:
            print(f"::warning title=Cupo {nombre}::{b_ / GB:.2f} GB transferidos este mes")
    if not filas:
        return
    c = psycopg2.connect(ctl, connect_timeout=60)
    with c.cursor() as cur:
        for f in filas:
            cur.execute("""INSERT INTO cupos (host, base, proyecto, transferido, periodo, proyecto_id)
                           VALUES (%s, %s, %s, %s, %s, %s)
                           ON CONFLICT (host) DO UPDATE SET base = EXCLUDED.base, proyecto = EXCLUDED.proyecto,
                               transferido = EXCLUDED.transferido, periodo = EXCLUDED.periodo,
                               proyecto_id = EXCLUDED.proyecto_id, actualizado = now()""", f)
    c.commit()
    c.close()
    principal = next((f for f in filas if f[1] == "principal"), None)
    if principal:
        print(f"::notice title=Cupo de la base principal::{principal[3] / GB:.2f} GB transferidos este mes")


if __name__ == "__main__":
    actualizar()
