"""Programador de tareas: lanza cada tarea diaria a su hora, en orden, y la repite si fallo.

Los horarios automaticos de GitHub no son confiables (pueden retrasarse horas o no ocurrir). Por eso el
programador no depende de ellos para cada tarea: queda encendido y revisa cada 10 minutos en las horas
en que hay tareas (de 9:30 p. m. a 9:30 a. m. y de 2:45 a 4:30 p. m., hora de Lima); fuera de esas horas
espera sin revisar nada. Antes del limite de 6 horas de GitHub se vuelve a lanzar solo. Si la cadena se
cortara, cualquiera de sus horarios de respaldo (cada 2 horas) la vuelve a encender.

Orden: una tarea que depende de otra espera a que esa termine (hasta 2 horas).
Fallas: se repiten 30 minutos despues de terminar (hasta 6 veces en el dia).

Tareas (hora de Lima):
  21:55, 02:00, 05:00, 15:00  Medicion de cupos de Neon (cupos.yml)
  22:40  Descarga diaria de normas (diario.yml)
  23:30  Dias pendientes del historico de El Peruano (historico.yml)
  01:20  Proyectos de ley, seguimiento y leyes publicadas (congreso.yml)
  02:20  Monitoreo: mes en curso, pedidos y un mes anterior (monitoreo.yml), despues del Congreso
  03:20  Resumen diario con IA (resumen.yml), despues de la descarga de normas
  04:00  Texto completo de lo nuevo (indexar.yml), despues del resumen
  05:00  Busquedas guardadas (busquedas.yml), despues del monitoreo
  05:30  Lectura de escaneados (ocr.yml), despues del texto completo
  06:00  Alarma de consumo (vigilar.yml)
  06:10  (lunes) Vocabulario del corrector de busquedas (vocabulario.yml)
  06:20  Rubro con IA de las normas sin rubro, hasta 300 consultas (clasificar.yml), despues del monitoreo
  07:00  Control de calidad del dia (control.yml), despues de todo lo anterior
  15:00  Recalificacion pendiente del monitoreo (recalificar.yml)
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

REPO = os.environ["GITHUB_REPOSITORY"]
API = f"https://api.github.com/repos/{REPO}/actions"
H = {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json"}
LIMA = timezone(timedelta(hours=-5))

TAREAS = [
    # (archivo, hora, minuto, inputs, depende_de, dia_de_semana o None)  (lunes = 0)
    ("cupos.yml", 21, 55, {}, None, None),
    ("diario.yml", 22, 40, {}, None, None),
    ("historico.yml", 23, 30, {}, None, None),
    ("congreso.yml", 1, 20, {}, None, None),
    ("cupos.yml", 2, 0, {}, None, None),
    ("resumen.yml", 3, 20, {}, "diario.yml", None),
    # Despues del resumen: este vuelve a bajar El Peruano y recoge las ediciones extraordinarias tardias,
    # que asi tambien se analizan esa noche. Ademas, a esa hora ya se renovo el cupo diario de la IA.
    ("monitoreo.yml", 3, 40, {"modo": "diario"}, ("resumen.yml", "congreso.yml"), None),
    ("indexar.yml", 4, 0, {}, "resumen.yml", None),
    ("busquedas.yml", 5, 0, {}, "monitoreo.yml", None),
    ("cupos.yml", 5, 0, {}, None, None),
    ("ocr.yml", 5, 30, {}, "indexar.yml", None),
    ("vigilar.yml", 6, 0, {}, None, None),
    ("vocabulario.yml", 6, 10, {}, None, 0),
    ("clasificar.yml", 6, 20, {}, "monitoreo.yml", None),
    ("control.yml", 7, 0, {}, "clasificar.yml", None),
    ("cupos.yml", 15, 0, {}, None, None),
    ("recalificar.yml", 15, 0, {}, None, None),
]
HORA = {a: (h, m) for a, h, m, *_ in reversed(TAREAS)}   # primera hora del dia de cada flujo (para dependencias)
# Horas en que se revisa (hora de Lima): (desde, hasta) en minutos del dia
VENTANAS = [(21 * 60 + 30, 24 * 60), (0, 9 * 60 + 30), (14 * 60 + 45, 16 * 60 + 30)]
PAUSA = 600                      # segundos entre revisiones
DURACION_MAXIMA = 5 * 3600 + 30 * 60   # luego se relanza (GitHub corta a las 6 horas)
MAX_INTENTOS = 6            # por dia y por tarea
# La alarma de consumo "falla" a proposito cuando una base se acerca a su limite: no se repite (cada
# repeticion volveria a consultar todas las bases para dar el mismo aviso)
SIN_REPETIR = {"vigilar.yml", "control.yml"}   # el control informa; repetirlo no arregla nada
ESPERA_REINTENTO = timedelta(minutes=30)   # una falla se repite en la revision siguiente (cada hora)


def ahora():
    return datetime.now(LIMA)


def corridas(archivo, desde):
    """Ejecuciones de un flujo creadas desde 'desde' (sin contar las canceladas)."""
    r = requests.get(f"{API}/workflows/{archivo}/runs", headers=H, timeout=60,
                     params={"created": f">={desde.astimezone(timezone.utc):%Y-%m-%dT%H:%M:%SZ}", "per_page": 30})
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return [x for x in r.json().get("workflow_runs", []) if x.get("conclusion") != "cancelled"]


def lanzar(archivo, inputs):
    r = requests.post(f"{API}/workflows/{archivo}/dispatches", headers=H, timeout=60,
                      json={"ref": "main", "inputs": inputs})
    print(f"{ahora():%Y-%m-%d %H:%M} lanzado {archivo} {inputs} -> HTTP {r.status_code}", flush=True)
    return r.status_code == 204


def hora_de_hoy(h, m):
    """Ultima vez que fueron las h:m (hoy o ayer, si todavia no llega esa hora hoy)."""
    n = ahora()
    t = n.replace(hour=h, minute=m, second=0, microsecond=0)
    return t if t <= n else t - timedelta(days=1)


def fallo(corrida):
    """True si algun trabajo de la ejecucion fallo (las tareas no se marcan como error: aqui se detecta)."""
    r = requests.get(f"{API}/runs/{corrida['id']}/jobs", headers=H, timeout=60, params={"per_page": 50})
    r.raise_for_status()
    return any(j.get("conclusion") not in ("success", "skipped") for j in r.json().get("jobs", []))


def en_ventana(t=None):
    t = t or ahora()
    minuto = t.hour * 60 + t.minute
    return any(a <= minuto < b for a, b in VENTANAS)


def revisar():
    lanzados = set()
    for archivo, h, m, inputs, depende, dia_semana in TAREAS:
        desde = hora_de_hoy(h, m)
        if dia_semana is not None and desde.weekday() != dia_semana:
            continue
        if ahora() - desde > timedelta(hours=20):
            continue   # ya paso demasiado: le tocara en su proxima hora
        ya = corridas(archivo, desde)
        if ya is None:
            continue   # el flujo no existe
        if ya:
            # Ya corrio desde su hora. Si fallo, se repite (cada 30 min, hasta 6 veces en el dia).
            if any(x["status"] != "completed" for x in ya) or len(ya) >= MAX_INTENTOS or archivo in SIN_REPETIR:
                continue
            ultima = max(ya, key=lambda x: x["created_at"])
            fin = datetime.fromisoformat(ultima["updated_at"].replace("Z", "+00:00"))
            if ahora() - fin < ESPERA_REINTENTO or not fallo(ultima):
                continue
            print(f"{ahora():%H:%M} {archivo} tuvo una falla; se repite", flush=True)
            if lanzar(archivo, inputs):
                lanzados.add(archivo)
            continue
        if ahora() - desde > timedelta(hours=10):
            continue   # nunca corrio y ya paso demasiado: le tocara en su proxima hora
        if depende:
            # Espera a que la tarea de la que depende haya terminado hoy (como maximo 2 horas)
            # (puede depender de varias: espera a todas)
            esperar = False
            for dep in (depende if isinstance(depende, tuple) else (depende,)):
                if dep in lanzados:
                    esperar = True
                    break
                dh, dm = HORA[dep]
                previas = corridas(dep, hora_de_hoy(dh, dm)) or []
                terminada = any(x["status"] == "completed" for x in previas)
                en_curso = any(x["status"] != "completed" for x in previas)
                if (en_curso or not terminada) and ahora() - desde < timedelta(hours=2):
                    esperar = True
                    break
            if esperar:
                continue
        if archivo in lanzados:
            continue
        if lanzar(archivo, inputs):
            lanzados.add(archivo)


def relanzarme():
    r = requests.post(f"{API}/workflows/programador.yml/dispatches", headers=H, timeout=60, json={"ref": "main"})
    print(f"{ahora():%Y-%m-%d %H:%M} programador relanzado -> HTTP {r.status_code}", flush=True)


def main():
    inicio = time.time()
    while True:
        if en_ventana():
            try:
                revisar()
            except Exception as e:  # noqa: BLE001  (una falla de la API de GitHub no detiene al programador)
                print(f"::warning title=Programador::{str(e)[:300]}", flush=True)
        if time.time() - inicio > DURACION_MAXIMA:
            relanzarme()
            return 0
        time.sleep(PAUSA)


if __name__ == "__main__":
    sys.exit(main())
