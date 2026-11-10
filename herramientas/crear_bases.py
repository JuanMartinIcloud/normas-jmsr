"""Crea en la cuenta de Neon del sistema nuevo las bases que faltan (solo nombres; nunca imprime claves ni
direcciones de conexion). Uso: python herramientas/crear_bases.py [cantidad_de_bases_de_texto]"""
import os
import sys
import time

import requests

API = "https://console.neon.tech/api/v2"
CLAVE = os.environ["NEON_API_KEY"]
H = {"Authorization": f"Bearer {CLAVE}", "Accept": "application/json", "Content-Type": "application/json"}
CANTIDAD = int(sys.argv[1]) if len(sys.argv) > 1 else 7


def pedir(metodo, ruta, **kw):
    r = requests.request(metodo, API + ruta, headers=H, timeout=60, **kw)
    if r.status_code >= 400:
        print(f"ERROR {r.status_code} en {ruta}: {r.text[:300]}")
        r.raise_for_status()
    return r.json()


def proyectos():
    # La clave de organizacion necesita el id de la organizacion para listar
    orgs = pedir("GET", "/users/me/organizations").get("organizations", [])
    org = orgs[0]["id"] if orgs else None
    datos = pedir("GET", "/projects" + (f"?org_id={org}" if org else ""))
    return org, datos.get("projects", [])


org, lista = proyectos()
print(f"Organizaciones encontradas: {'si' if org else 'no'}; proyectos actuales: {len(lista)}")
for p in lista:
    print(f"  - {p['name']} | region {p['region_id']} | id {p['id']}")
principal = next((p for p in lista if p["name"] == "normas-jmsr-principal"), None)
region = principal["region_id"] if principal else "aws-us-east-1"
nombres = {p["name"] for p in lista}
for i in range(1, CANTIDAD + 1):
    nombre = f"normas-jmsr-textos-{i}"
    if nombre in nombres:
        print(f"Ya existe: {nombre}")
        continue
    cuerpo = {"project": {"name": nombre, "region_id": region, "pg_version": principal["pg_version"] if principal else 17}}
    if org:
        cuerpo["project"]["org_id"] = org
    pedir("POST", "/projects", json=cuerpo)
    print(f"Creada: {nombre} ({region})")
    time.sleep(3)
org, lista = proyectos()
print(f"Proyectos al final: {len(lista)}")
for p in sorted(lista, key=lambda x: x["name"]):
    print(f"  - {p['name']} | region {p['region_id']}")
