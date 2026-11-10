"""Descarga el seguimiento de los expedientes del Congreso (dictamenes, remisiones al Senado,
autografas, etc.) y lo guarda en la tabla "seguimientos".

Revisa todos los proyectos del periodo parlamentario actual y, de los anteriores, los que
cambiaron de estado en los ultimos 30 dias.

    python src/seguimiento.py [--max-minutos 40]
"""
import argparse
import re
import time
from datetime import datetime

import requests
from psycopg2.extras import execute_values

import db
from textos import API_CONGRESO, CABECERAS_CONGRESO, cifrar

PAUSA = 0.5
_s = requests.Session()
# Enlace al expediente de la otra camara (p. ej. la propuesta que el Senado recibe de Diputados)
_ENLACE = re.compile(r"/(diputados|senado)/expediente/(\d{4})/(\d+)", re.I)


def enlace_de(e, camara):
    """(camara, periodo, numero) del mismo expediente en la otra camara, segun los archivos del seguimiento."""
    for s in e.get("seguimientos") or []:
        for a in s.get("archivos") or []:
            m = _ENLACE.search(a.get("enlace") or "")
            if m and "EXPEDIENTE" in (a.get("descripcion") or "").upper():
                otra = "D" if m.group(1).lower() == "diputados" else "S"
                if otra != camara:
                    return otra, m.group(2), int(m.group(3))
    return None


def expediente(periodo, camara, num_pley):
    url = f"{API_CONGRESO}/expediente/{cifrar(str(periodo))}/{cifrar(str(num_pley))}"
    for intento in range(4):
        try:
            r = _s.get(url, params={"codTipoParl": camara or "C"}, headers=CABECERAS_CONGRESO, timeout=60)
            if r.status_code == 404:
                return {}
            r.raise_for_status()
            return r.json().get("data") or {}
        except (requests.RequestException, ValueError):
            time.sleep(5 * (intento + 1))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-minutos", type=float, default=40)
    a = ap.parse_args()
    fin = time.time() + a.max_minutos * 60
    conn = db.conectar()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, periodo, camara, num_pley FROM proyectos_ley
               WHERE num_pley IS NOT NULL
                 AND (periodo = (SELECT max(periodo) FROM proyectos_ley)
                      OR estado_cambiado_en >= now() - interval '30 days')
               ORDER BY seguimiento_revisado NULLS FIRST, fecha_presentacion DESC"""
        )
        proyectos = cur.fetchall()
    conn.commit()
    print(f"Proyectos a revisar: {len(proyectos)}")
    hechos = nuevos = 0
    filas, revisados, actuales, enlaces = [], [], [], []

    def guardar():
        nonlocal nuevos, filas, revisados, actuales, enlaces
        c = db.conectar()   # conexion nueva: la base se apaga sola si pasa tiempo sin uso
        with c.cursor() as cur:
            if filas:
                execute_values(
                    cur,
                    """INSERT INTO seguimientos (id, proyecto_id, fecha, camara, estado, comisiones, detalle)
                       VALUES %s ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado,
                         comisiones = EXCLUDED.comisiones, detalle = EXCLUDED.detalle, fecha = EXCLUDED.fecha
                       RETURNING (xmax = 0)""",
                    filas, fetch=True,
                )
                nuevos += sum(1 for (n,) in cur.fetchall() if n)
            if actuales:
                cur.execute("UPDATE proyectos_ley SET seguimiento_revisado = now() WHERE id = ANY(%s)",
                            ([a[0] for a in actuales],))
            # Misma iniciativa en las dos camaras: cada registro apunta al otro
            for pid_, cam_, per_, num_ in enlaces:
                cur.execute("""UPDATE proyectos_ley p SET enlace_id = o.id FROM proyectos_ley o
                               WHERE p.id = %s AND o.camara = %s AND o.periodo = %s AND o.num_pley = %s
                                 AND p.enlace_id IS DISTINCT FROM o.id RETURNING o.id""", (pid_, cam_, per_, num_))
                for (oid,) in cur.fetchall():
                    cur.execute("UPDATE proyectos_ley SET enlace_id = %s WHERE id = %s AND enlace_id IS NULL", (pid_, oid))
        c.commit()
        c.close()
        filas, revisados, actuales, enlaces = [], [], [], []

    for pid, periodo, camara, num in proyectos:
        if time.time() > fin:
            break
        e = expediente(periodo, camara, num)
        if e is None:
            continue
        for s in e.get("seguimientos") or []:
            sid = s.get("seguimientoPleyId")
            fecha = s.get("fecha")
            if not sid or not fecha:
                continue
            filas.append((
                sid, pid, datetime.fromisoformat(fecha.replace("Z", "+00:00")),
                (s.get("codTipoParl") or camara or "C")[:1], (s.get("desEstado") or "").strip(),
                (s.get("desComisiones") or "").strip() or None,
                ((s.get("detalle") or s.get("observacion") or "").strip() or None),
            ))
        otro = enlace_de(e, camara)
        if otro:
            enlaces.append((pid, *otro))
        actuales.append((pid,))
        hechos += 1
        if hechos % 100 == 0:
            guardar()
            print(f"  {hechos} expedientes revisados")
        time.sleep(PAUSA)
    guardar()
    print(f"Expedientes revisados: {hechos}; movimientos nuevos: {nuevos}")


if __name__ == "__main__":
    main()
