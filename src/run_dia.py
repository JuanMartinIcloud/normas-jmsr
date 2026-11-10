"""Descarga las normas de ayer y de hoy (o de una fecha) y las guarda en Neon.

    python src/run_dia.py                 # ayer y hoy (hora de Lima)
    python src/run_dia.py 2026-10-09      # una fecha
    python src/run_dia.py --sin-bd        # solo muestra lo descargado, no escribe en la base

Se repasa tambien el dia anterior porque GitHub a veces ejecuta la tarea con horas de
retraso y porque las ediciones extraordinarias pueden salir tarde. Las normas que ya
estaban guardadas no se duplican.
"""
import sys
from datetime import date, datetime, timedelta, timezone

import db
import elperuano


def hoy_lima() -> date:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sin_bd = "--sin-bd" in sys.argv
    if args:
        fechas = [date.fromisoformat(args[0])]
    else:
        hoy = hoy_lima()
        fechas = [hoy - timedelta(days=1), hoy]

    conn = None if sin_bd else db.conectar()
    try:
        for fecha in fechas:
            filas = elperuano.descargar_dia(fecha)
            print(f"{fecha}: {len(filas)} normas encontradas")
            if sin_bd:
                for f in filas[:10]:
                    print(f"  [{f['sector']} / {f['rubro']}] {f['tipo']} {f['numero']} - {(f['sumilla'] or '')[:90]}")
                continue
            nuevas = db.insertar_normas(conn, filas)
            if filas or fecha < hoy_lima():
                # Un "hoy" sin normas no se marca como vacio: puede que la edicion aun no salga
                db.marcar_dia(conn, fecha, "ok" if filas else "vacio", len(filas))
            print(f"{nuevas} nuevas guardadas en la base")
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
