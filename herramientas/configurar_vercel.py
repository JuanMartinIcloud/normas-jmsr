"""Copia a Vercel las claves que necesita la web y vuelve a publicarla.

Asi las claves se escriben una sola vez (en los secretos de GitHub) y nadie tiene que copiarlas a mano:
- TEXTOS_URL_n de cada base: se leen de la API de Neon (secreto NEON_API_KEY).
- GEMINI_API_KEY, GEMINI_MODELOS y GITHUB_TAREAS: de los secretos de GitHub, si estan definidos.
Necesita el secreto VERCEL_TOKEN (una clave de Vercel). Nunca imprime ninguna clave.
"""
import os
import sys

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import neon_urls  # noqa: E402

API = "https://api.vercel.com"
PROYECTO = os.getenv("VERCEL_PROYECTO", "normas-jmsr")
H = {"Authorization": f"Bearer {os.environ['VERCEL_TOKEN'].strip()}", "Content-Type": "application/json"}


EQUIPO = {}   # {"teamId": ...} si el token es de un equipo de Vercel (se averigua en buscar_proyecto)


def pedir(metodo, ruta, **kw):
    kw["params"] = {**EQUIPO, **kw.get("params", {})}
    r = requests.request(metodo, API + ruta, headers=H, timeout=60, **kw)
    if r.status_code >= 400:
        # El mensaje de Vercel no contiene claves; se muestra recortado para saber que fallo
        raise SystemExit(f"::error title=Vercel::{metodo} {ruta.split('?')[0]} respondio {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else {}


def buscar_proyecto():
    """El proyecto puede estar en la cuenta personal o en un equipo de Vercel: se prueba en cada uno."""
    r = requests.get(f"{API}/v9/projects/{PROYECTO}", headers=H, timeout=60)
    if r.status_code == 200:
        return r.json()
    equipos = requests.get(f"{API}/v2/teams", headers=H, timeout=60)
    for t in (equipos.json().get("teams", []) if equipos.status_code == 200 else []):
        r = requests.get(f"{API}/v9/projects/{PROYECTO}", headers=H, params={"teamId": t["id"]}, timeout=60)
        if r.status_code == 200:
            EQUIPO["teamId"] = t["id"]
            return r.json()
    raise SystemExit(f"::error title=Vercel::No encontre el proyecto {PROYECTO} con este token "
                     f"(respuesta {r.status_code}: {r.text[:200]}).")


def main():
    proyecto = buscar_proyecto()
    print(f"Proyecto de Vercel encontrado: {proyecto['name']}")

    valores = {}
    for n, uri in neon_urls.direcciones(os.environ["NEON_API_KEY"].strip()).items():
        print(f"::add-mask::{uri}")
        valores[f"TEXTOS_URL_{n}"] = uri
    for clave in ("GEMINI_API_KEY", "GEMINI_MODELOS", "GITHUB_TAREAS"):
        v = os.getenv(clave, "").strip()
        if v:
            print(f"::add-mask::{v}")
            valores[clave] = v
    if "TEXTOS_URL_4" not in valores:
        raise SystemExit("::error::No se encontro la base principal en Neon.")

    for clave, valor in sorted(valores.items()):
        pedir("POST", f"/v10/projects/{proyecto['id']}/env?upsert=true",
              json={"key": clave, "value": valor, "type": "encrypted", "target": ["production", "preview"]})
        print(f"  {clave}: guardada en Vercel")
    faltan = [c for c in ("GEMINI_API_KEY", "GITHUB_TAREAS") if c not in valores]
    if faltan:
        print(f"::warning::Todavia no estan en los secretos de GitHub: {', '.join(faltan)}")

    enlace = proyecto.get("link") or {}
    if not enlace.get("repoId"):
        print("::warning::El proyecto de Vercel no esta enlazado a GitHub; publicalo a mano para que tome las claves.")
        return
    d = pedir("POST", "/v13/deployments", json={
        "name": proyecto["name"], "project": proyecto["id"], "target": "production",
        "gitSource": {"type": "github", "repoId": enlace["repoId"], "ref": enlace.get("productionBranch") or "main"},
    })
    print(f"Nueva publicacion de la web lanzada (estado: {d.get('readyState') or d.get('status')}).")


if __name__ == "__main__":
    main()
