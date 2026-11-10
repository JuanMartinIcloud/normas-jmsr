"""Comprueba que cada base del sistema responde (no imprime direcciones ni claves)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import psycopg2  # noqa: E402

import bases  # noqa: E402  (al importarse, obtiene las direcciones con NEON_API_KEY)

lista = [(4, bases.url_principal())] + bases.bases_texto()
print(f"Bases encontradas: {len(lista)} (principal + {len(lista) - 1} de texto)")
for n, url in lista:
    try:
        c = psycopg2.connect(url, connect_timeout=60)
        cur = c.cursor()
        cur.execute("SELECT current_database(), pg_size_pretty(pg_database_size(current_database())), version()")
        bd, tam, ver = cur.fetchone()
        print(f"  TEXTOS_URL_{n}: responde | base {bd} | {tam} | {ver.split(',')[0]}")
        c.close()
    except Exception as e:  # noqa: BLE001
        print(f"  TEXTOS_URL_{n}: ERROR {type(e).__name__}: {str(e)[:150]}")
