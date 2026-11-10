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

# Aplica en la base principal las etapas del esquema que falten (por ejemplo, despues de copiar los datos)
import db  # noqa: E402

db.conectar().close()
c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
cur = c.cursor()
cur.execute("""SELECT (SELECT count(*) FROM normas), (SELECT count(*) FROM proyectos_ley),
                      (SELECT count(*) FROM areas), (SELECT count(*) FROM usuarios),
                      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'excel_descargas')""")
n, p, a, u, excel = cur.fetchone()
print(f"Base principal: {n} normas, {p} proyectos, {a} areas, {u} usuarios | esquema al dia: {'si' if excel else 'NO'}")
c.close()
