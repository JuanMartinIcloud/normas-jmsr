"""Vuelve a clasificar el sector y el rubro de todas las normas (y el rubro de los proyectos de ley) con las
reglas vigentes de src/classifier.py. Solo cambia las que cambian.

    python src/reclasificar.py simular    # no escribe nada: cuenta cuantas cambian y muestra ejemplos
    python src/reclasificar.py aplicar    # escribe los cambios
"""
import random
import sys
from collections import Counter

import psycopg2
from psycopg2.extras import execute_values

import bases
import db
from classifier import clasificar_rubro, clasificar_sector


def avisar(lineas, titulo):
    partes, actual = [], ""
    for linea in lineas:
        if actual and len(actual) + len(linea) > 3500:
            partes.append(actual)
            actual = ""
        actual += linea + "\n"
    if actual:
        partes.append(actual)
    for i, parte in enumerate(partes[:10], 1):
        cod = parte.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
        print(f"::notice title={titulo} ({i}/{len(partes)})::{cod}")


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else "simular"
    if modo not in ("simular", "aplicar"):
        raise SystemExit("Modo: simular | aplicar")
    db.conectar().close()   # aplica las etapas pendientes del esquema
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cambios_n, cambios_p = [], []
    antes_sector, antes_rubro, despues_sector, despues_rubro = Counter(), Counter(), Counter(), Counter()
    ejemplos = []
    with c.cursor(name="normas") as cur:   # lectura por partes (no carga todo en memoria)
        cur.itersize = 5000
        cur.execute("SELECT id, entidad, tipo, sumilla, sector, rubro, rubro_ia FROM normas")
        for nid, entidad, tipo, sumilla, sector, rubro, rubro_ia in cur:
            s = clasificar_sector(entidad or "")
            r = clasificar_rubro(sumilla or "", tipo or "")
            if r == "Sin clasificar" and rubro_ia:
                r = rubro   # el rubro que puso la IA se conserva si las reglas no encuentran otro
            antes_sector[sector] += 1
            antes_rubro[rubro] += 1
            despues_sector[s] += 1
            despues_rubro[r] += 1
            if s != sector or r != rubro:
                cambios_n.append((nid, s, r))
                if len(ejemplos) < 4000:
                    ejemplos.append((entidad, (sumilla or "")[:90], sector, s, rubro, r))
    with c.cursor() as cur:
        cur.execute("SELECT id, titulo, rubro, rubro_ia FROM proyectos_ley")
        for pid, titulo, rubro, rubro_ia in cur.fetchall():
            r = clasificar_rubro(titulo or "")
            if r == "Sin clasificar" and rubro_ia:
                r = rubro   # el rubro que puso la IA se conserva si las reglas no encuentran otro
            if r != rubro:
                cambios_p.append((pid, r))
    c.rollback()
    total = sum(antes_sector.values())
    lineas = [
        f"Normas: {total}; cambian: {len(cambios_n)}. Proyectos de ley que cambian de rubro: {len(cambios_p)}",
        f"Sector 'Otros': antes {antes_sector['Otros']}, despues {despues_sector['Otros']}",
        f"Rubro 'Sin clasificar': antes {antes_rubro['Sin clasificar']}, despues {despues_rubro['Sin clasificar']}",
        "Sectores despues: " + ", ".join(f"{k} {v}" for k, v in despues_sector.most_common()),
        "Rubros despues: " + ", ".join(f"{k} {v}" for k, v in despues_rubro.most_common()),
    ]
    random.seed(7)
    lineas.append("Muestra de 30 cambios (entidad | sumilla | sector antes -> despues | rubro antes -> despues):")
    for e, su, sa, sd, ra, rd in random.sample(ejemplos, min(30, len(ejemplos))):
        lineas.append(f"  {e} | {su} | {sa} -> {sd} | {ra} -> {rd}")
    if modo == "aplicar":
        with c.cursor() as cur:
            execute_values(cur, """UPDATE normas n SET sector = v.s, rubro = v.r FROM (VALUES %s) AS v(id, s, r)
                                   WHERE n.id = v.id""", cambios_n, page_size=2000)
            execute_values(cur, """UPDATE proyectos_ley p SET rubro = v.r FROM (VALUES %s) AS v(id, r)
                                   WHERE p.id = v.id""", cambios_p, page_size=2000)
        c.commit()
        lineas.insert(0, "CAMBIOS APLICADOS.")
    else:
        lineas.insert(0, "SIMULACION: no se escribio nada.")
    c.close()
    print("\n".join(lineas))
    avisar(lineas, f"Reclasificacion {modo}")


if __name__ == "__main__":
    main()
