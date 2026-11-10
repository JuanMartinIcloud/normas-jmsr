"""Descarga todos los proyectos de ley del portal del Congreso y los guarda en Neon.

    python src/run_congreso.py             # todos los periodos disponibles
    python src/run_congreso.py --sin-bd    # solo cuenta, no escribe
"""
import sys

import congreso
import db


def actualizar(conn) -> int:
    """Recorre todos los periodos y camaras. Con conn=None solo cuenta. Devuelve cuantos proceso."""
    total = 0
    for per in congreso.periodos():
        for camara in congreso.CAMARAS:
            vistos = 0
            for lote, _ in congreso.paginas(per["perParId"], camara):
                filas = [congreso.normalizar(p, camara) for p in lote]
                vistos += len(filas)
                if conn:
                    total += db.upsert_proyectos(conn, filas)
            if vistos:
                print(f"periodo {per['desPerParAbrev']} camara {camara}: {vistos} proyectos")
    return total


def main():
    sin_bd = "--sin-bd" in sys.argv
    conn = None if sin_bd else db.conectar()
    try:
        total_guardados = actualizar(conn)
    finally:
        if conn:
            conn.close()
    print(f"Total procesados: {total_guardados} (solo se escriben los que cambiaron)")


if __name__ == "__main__":
    main()
