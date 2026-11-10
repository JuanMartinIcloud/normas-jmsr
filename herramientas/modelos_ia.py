"""Muestra que modelos de Gemini responden con la clave (capa gratuita) y cuanto usaron hoy.

1. Lista los modelos que la clave puede usar para generar texto.
2. Prueba cada modelo «pro» y «flash» con una consulta minima (gasta 1 consulta de cada uno).
3. Del registro uso_ia: consultas de hoy por modelo y resultado (desde las 3:00 de Lima, cuando se renueva el cupo).
No imprime la clave.
"""
import os
import sys

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import neon_urls  # noqa: E402

neon_urls.completar_entorno()
CLAVE = os.environ["GEMINI_API_KEY"].strip()
API = "https://generativelanguage.googleapis.com/v1beta"

r = requests.get(f"{API}/models", params={"key": CLAVE, "pageSize": 1000}, timeout=60)
r.raise_for_status()
modelos = [m["name"].split("/", 1)[1] for m in r.json().get("models", [])
           if "generateContent" in m.get("supportedGenerationMethods", [])]
print(f"Modelos disponibles para generar texto: {len(modelos)}")
for m in sorted(modelos):
    print(f"  {m}")

print("\nPrueba de respuesta (pro y flash):")
for m in sorted(modelos):
    if not any(x in m for x in ("pro", "flash")) or any(x in m for x in ("image", "tts", "audio", "live", "embedding")):
        continue
    p = requests.post(f"{API}/models/{m}:generateContent", params={"key": CLAVE}, timeout=120,
                      json={"contents": [{"parts": [{"text": "Responde solo: ok"}]}],
                            "generationConfig": {"maxOutputTokens": 512}})
    detalle = ""
    if p.status_code != 200:
        try:
            detalle = p.json().get("error", {}).get("message", "")[:160]
        except ValueError:
            detalle = p.text[:160]
    print(f"  {m}: {'RESPONDE' if p.status_code == 200 else f'NO ({p.status_code}) {detalle}'}")

try:
    import psycopg2
    c = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=60)
    cur = c.cursor()
    cur.execute("""SELECT modelo, resultado, count(*) FROM uso_ia
                   WHERE creado_en >= (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')
                   GROUP BY 1, 2 ORDER BY 1, 2""")
    print("\nConsultas desde que se renovo el cupo (medianoche de California = 3:00 de Lima):")
    for fila in cur.fetchall():
        print(f"  {fila[0]} | {fila[1]} | {fila[2]}")
except Exception as e:  # noqa: BLE001
    print(f"\n(no se pudo leer uso_ia: {type(e).__name__})")
