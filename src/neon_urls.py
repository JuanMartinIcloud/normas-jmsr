"""Direcciones de conexion de las bases del sistema, obtenidas de la API de Neon.

Asi basta un solo secreto (NEON_API_KEY): las direcciones de cada base no se copian a mano en ningun lado.
Si una variable TEXTOS_URL_n o DATABASE_URL ya viene definida, se respeta.

Correspondencia (los mismos numeros que usa el resto del codigo, ver bases.py):
  normas-jmsr-principal -> TEXTOS_URL_4 (y DATABASE_URL)
  normas-jmsr-textos-1..7 -> TEXTOS_URL_2, 3, 5, 6, 7, 8, 9  (la textos-1 es ademas la base de control)
"""
import os
import re

import requests

API = "https://console.neon.tech/api/v2"
NUMEROS = {"normas-jmsr-principal": 4, "normas-jmsr-textos-1": 2, "normas-jmsr-textos-2": 3,
           "normas-jmsr-textos-3": 5, "normas-jmsr-textos-4": 6, "normas-jmsr-textos-5": 7,
           "normas-jmsr-textos-6": 8, "normas-jmsr-textos-7": 9}


def _pedir(ruta, clave, **params):
    r = requests.get(API + ruta, headers={"Authorization": f"Bearer {clave}", "Accept": "application/json"},
                     params=params, timeout=60)
    if r.status_code >= 400:
        # El mensaje de Neon no contiene claves; se muestra para saber que fallo
        raise requests.HTTPError(f"Neon respondio {r.status_code} en {ruta}: {r.text[:200]}", response=r)
    return r.json()


def organizaciones(clave):
    """Organizaciones visibles con la clave. Una clave de organizacion no puede consultar /users/me: en ese
    caso se devuelve [None] y los proyectos se piden sin indicar organizacion (la clave ya la determina)."""
    try:
        return _pedir("/users/me/organizations", clave).get("organizations") or [None]
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code in (400, 401, 403, 404):
            return [None]
        raise


def direcciones(clave):
    """{numero: direccion de conexion} de cada base del sistema."""
    org = organizaciones(clave)[0]
    params = {"org_id": org["id"]} if org else {}
    salida = {}
    for p in _pedir("/projects", clave, **params).get("projects", []):
        n = NUMEROS.get(p["name"])
        if not n:
            continue
        rama = next((b for b in _pedir(f"/projects/{p['id']}/branches", clave)["branches"] if b.get("default")), None)
        if not rama:
            continue
        bd = _pedir(f"/projects/{p['id']}/branches/{rama['id']}/databases", clave)["databases"][0]
        uri = _pedir(f"/projects/{p['id']}/connection_uri", clave, branch_id=rama["id"],
                     database_name=bd["name"], role_name=bd["owner_name"])["uri"]
        salida[n] = uri
    return salida


def completar_entorno():
    """Define TEXTOS_URL_n y DATABASE_URL que falten, a partir de NEON_API_KEY."""
    clave = os.getenv("NEON_API_KEY", "").strip()
    if not clave or os.getenv("_NEON_URLS_LISTAS"):
        return
    try:
        for n, uri in direcciones(clave).items():
            if os.getenv("GITHUB_ACTIONS"):
                # El registro de las tareas es publico: GitHub tapa estas direcciones si llegaran a aparecer
                print(f"::add-mask::{uri}")
                clave_bd = re.search(r"://[^:/]+:([^@]+)@", uri)
                if clave_bd:
                    print(f"::add-mask::{clave_bd.group(1)}")
            os.environ.setdefault(f"TEXTOS_URL_{n}", uri)
        if os.getenv("TEXTOS_URL_4"):
            os.environ.setdefault("DATABASE_URL", os.environ["TEXTOS_URL_4"])
        os.environ["_NEON_URLS_LISTAS"] = "1"
    except requests.RequestException as e:
        print(f"::warning title=Neon::No se pudieron leer las direcciones de las bases: {str(e)[:200]}")
