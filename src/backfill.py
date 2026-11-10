"""Carga historica por tandas, de la fecha mas reciente hacia atras, con punto de control.

    python src/backfill.py --desde 1990-01-01 --max-dias 400 --max-minutos 330

- Salta los dias ya marcados como 'ok' o 'vacio' (se puede cortar y reanudar sin perder nada).
- Se detiene al llegar a --max-dias o --max-minutos (GitHub Actions corta a las 6 h).
"""
import argparse
import time
from datetime import date, datetime, timedelta, timezone

import db
import elperuano


def hoy_lima() -> date:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--desde", default="2019-01-01", help="fecha mas antigua a cubrir (YYYY-MM-DD)")
    p.add_argument("--hasta", default=None, help="fecha mas reciente (por defecto, hoy)")
    p.add_argument("--max-dias", type=int, default=400)
    p.add_argument("--max-minutos", type=int, default=330)
    a = p.parse_args()

    desde = date.fromisoformat(a.desde)
    hasta = date.fromisoformat(a.hasta) if a.hasta else hoy_lima()
    inicio = time.time()

    conn = db.conectar()
    try:
        pendientes = db.dias_pendientes(conn, desde, hasta)
        print(f"{len(pendientes)} dias pendientes entre {desde} y {hasta}")
        hechos = 0
        for dia in pendientes:
            if hechos >= a.max_dias or (time.time() - inicio) / 60 >= a.max_minutos:
                print("Limite de la tanda alcanzado; se continuara en la proxima ejecucion.")
                break
            try:
                filas = elperuano.descargar_dia(dia)
                db.insertar_normas(conn, filas)
                db.marcar_dia(conn, dia, "ok" if filas else "vacio", len(filas))
                print(f"{dia}: {len(filas)} normas")
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                db.marcar_dia(conn, dia, "error", 0, str(e))
                print(f"{dia}: ERROR {e}")
            hechos += 1
    finally:
        conn.close()


if __name__ == "__main__":
    main()
