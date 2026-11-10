"""Alarma de consumo: revisa cada dia que ninguna base de Neon se acerque a sus limites gratuitos.

- Espacio de cada base (limite 1024 MB por proyecto gratuito): con las cadenas de conexion.
- Horas de computo (100 CU-hora al mes por proyecto) y transferencia (5 GB al mes): con la API de
  Neon, si existe el secreto NEON_API_KEY (clave de solo lectura de la cuenta de Neon).

Si algo pasa del 70 % deja un aviso; si pasa del 85 % la tarea termina en error (marca roja en la
pestaña Actions de GitHub). No se repite el mismo dia (ver SIN_REPETIR en src/programador.py).
"""
import os
import sys

import psycopg2
import requests

import bases

LIMITE_CU_HORAS = 100
LIMITE_TRANSFER_GB = 5
LIMITE_ESPACIO_MB = 1024
AVISO, ALARMA = 0.70, 0.85


def nivel(fraccion):
    return "ALARMA" if fraccion >= ALARMA else ("aviso" if fraccion >= AVISO else "ok")


def revisar_espacio():
    lista = [("principal", bases.url_principal())] + [(f"texto {i}", u) for i, u in bases.bases_texto()]
    peor = 0.0
    for nombre, url in lista:
        if not url.strip():
            continue
        try:
            c = psycopg2.connect(url, connect_timeout=30)
            cur = c.cursor()
            cur.execute("SELECT pg_database_size(current_database()) / 1048576.0")
            mb = float(cur.fetchone()[0])
            c.close()
        except Exception as e:  # noqa: BLE001
            print(f"::warning title=Base {nombre}::No respondio: {str(e)[:200]}")
            continue
        f = mb / LIMITE_ESPACIO_MB
        # Las bases de texto se llenan a proposito hasta 900 MB (~88%; el indexador para ahi y pasa a la
        # siguiente); solo preocupa si alguna sigue creciendo por encima del 93%. La principal alarma desde el 85%.
        if nombre.startswith("texto") and f < 0.93:
            peor = max(peor, min(f, ALARMA - 0.01))
        else:
            peor = max(peor, f)
        print(f"Espacio {nombre}: {mb:.0f} MB de {LIMITE_ESPACIO_MB} ({f:.0%}) [{nivel(f)}]")
        if f >= AVISO:
            print(f"::warning title=Espacio {nombre}::{mb:.0f} MB usados ({f:.0%} del limite gratuito)")
    return peor


def revisar_computo():
    clave = os.getenv("NEON_API_KEY", "").strip()
    if not clave:
        print("::notice title=Computo::Sin NEON_API_KEY no se pueden leer las horas de computo de Neon.")
        return 0.0
    h = {"Authorization": f"Bearer {clave}", "Accept": "application/json"}
    # Las claves personales necesitan la organizacion para listar los proyectos
    orgs = requests.get("https://console.neon.tech/api/v2/users/me/organizations", headers=h, timeout=60)
    orgs.raise_for_status()
    params = {"limit": 100}
    if orgs.json().get("organizations"):
        params["org_id"] = orgs.json()["organizations"][0]["id"]
    r = requests.get("https://console.neon.tech/api/v2/projects", headers=h, params=params, timeout=60)
    r.raise_for_status()
    peor = 0.0
    for p in r.json().get("projects", []):
        if not str(p.get("name", "")).startswith("normas-textos-"):
            continue   # otros proyectos de la cuenta: no son de este sistema (y el registro de GitHub es publico)
        d = requests.get(f"https://console.neon.tech/api/v2/projects/{p['id']}", headers=h, timeout=60)
        d.raise_for_status()
        q = d.json().get("project", {})
        cu = (q.get("compute_time_seconds") or 0) / 3600
        gb = (q.get("data_transfer_bytes") or 0) / 1e9
        f = max(cu / LIMITE_CU_HORAS, gb / LIMITE_TRANSFER_GB)
        peor = max(peor, f)
        print(f"Computo {q.get('name')}: {cu:.1f} de {LIMITE_CU_HORAS} CU-hora, transferencia {gb:.2f} de "
              f"{LIMITE_TRANSFER_GB} GB (periodo desde {q.get('consumption_period_start')}) [{nivel(f)}]")
        if f >= AVISO:
            print(f"::warning title=Computo {q.get('name')}::{cu:.1f} CU-hora y {gb:.2f} GB usados ({f:.0%} del limite)")
    return peor


def main():
    peor = max(revisar_espacio(), revisar_computo())
    if peor >= ALARMA:
        print(f"::error title=Limite cercano::Una base de Neon esta al {peor:.0%} de su limite gratuito.")
        sys.exit(1)


if __name__ == "__main__":
    main()
