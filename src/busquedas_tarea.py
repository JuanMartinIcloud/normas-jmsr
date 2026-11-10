"""Ejecuta en la web las busquedas guardadas que tocan hoy (lo lanza el programador una vez al dia)."""
import os, time, psycopg2, requests
import cupos
if cupos.principal_en_emergencia():
    raise SystemExit(0)
c = psycopg2.connect(os.environ["DATABASE_URL"]); cur = c.cursor()
cur.execute("SELECT valor FROM configuracion WHERE clave = 'clave_tareas'")
fila = cur.fetchone(); c.close()
if not fila:
    print("::notice::Todavia no hay busquedas guardadas."); raise SystemExit(0)
for vuelta in range(8):
    r = requests.post("https://normas-peru.vercel.app/api/busquedas/ejecutar", headers={"x-clave-tareas": fila[0]}, timeout=320)
    try:
        d = r.json()
    except ValueError:
        d = {}
    for h in d.get("hechas", []):
        # El repositorio es publico: el aviso no lleva el nombre de la busqueda, solo su numero
        print(f"::notice title=Busqueda {h['id']}::{h['normas']} normas, {h['proyectos']} proyectos, correo enviado: {h['enviado']}")
    if r.status_code != 200:
        print(f"Respuesta de la web: HTTP {r.status_code}"); raise SystemExit(1)
    if not d.get("pendientes"):
        break
    time.sleep(5)
