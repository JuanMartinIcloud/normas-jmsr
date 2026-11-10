"""Vuelve a calificar, con los criterios vigentes (version CRITERIO de monitoreo.py), los documentos del
monitoreo analizados antes: decide si siguen en el reporte, su calificacion y su puntaje de impacto (1-10).

    python src/recalificar_monitoreo.py --max-minutos 50
    python src/recalificar_monitoreo.py --contar        # cuantos faltan (para el relanzador)

Usa lo ya analizado (sumilla, en que consiste, que cambia, comentario): no vuelve a leer los textos.
"""
import argparse
import time

import cupos
import db
import gemini
from monitoreo import (CALIFICACIONES, CRITERIO, CRITERIOS_CALIFICACION, INDIVIDUAL,
                       NO_RELEVANTES, entero_1_10, es_local, impacto_de)

LOTE = 15
MODELOS = gemini.modelos_lite()   # trabajo automatico: solo Lite

INSTR = f"""Eres analista senior de asuntos públicos y regulatorios de la Cámara de Comercio Americana del
Perú (AmCham Perú). Recibes documentos (normas legales o proyectos de ley) ya resumidos. Para cada uno
decide, con los criterios de abajo:
- "relevante": true si debe estar en el reporte para las empresas y el clima de inversiones; false si
  corresponde a alguno de los casos que NO son relevantes.
- "calificacion": "Favorable", "Desfavorable" o "Para seguimiento".
- "puntaje": entero del 1 al 10.
- {INDIVIDUAL}
Responde solo con el JSON pedido, con un elemento por cada id recibido.

{NO_RELEVANTES}

{CRITERIOS_CALIFICACION}"""

ESQUEMA = {"type": "OBJECT", "properties": {"documentos": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
    "id": {"type": "STRING"}, "relevante": {"type": "BOOLEAN"}, "calificacion": {"type": "STRING"},
    "puntaje": {"type": "INTEGER"}, "acto_individual": {"type": "BOOLEAN"}},
    "required": ["id", "relevante", "calificacion", "puntaje", "acto_individual"]}}},
    "required": ["documentos"]}

SQL_PENDIENTES = """
    SELECT a.id, a.tipo,
           coalesce(n.tipo || ' ' || coalesce(n.numero, ''), 'Proyecto de ley ' || p.numero),
           coalesce(n.entidad, p.proponente, ''), coalesce(n.sumilla, p.titulo, ''),
           coalesce(a.resumen, ''), coalesce(a.cambios, ''), coalesce(a.comentario, ''),
           n.tipo, n.entidad, n.sector
    FROM analisis a
    LEFT JOIN normas n ON a.tipo = 'N' AND n.id = a.ref_id
    LEFT JOIN proyectos_ley p ON a.tipo = 'P' AND p.id = a.ref_id
    WHERE a.relevante AND NOT a.manual AND a.criterio IS DISTINCT FROM %s
    ORDER BY a.fecha DESC, a.id"""


def pendientes(conn, limite=None, buscar=None):
    """buscar: expresion (sin distinguir mayusculas) que debe aparecer en la sumilla, el titulo o el analisis."""
    sql, args = SQL_PENDIENTES, [CRITERIO]
    if buscar:
        sql = sql.replace("ORDER BY", """AND (coalesce(n.sumilla, '') ~* %s OR coalesce(p.titulo, '') ~* %s
                                           OR coalesce(a.resumen, '') ~* %s) ORDER BY""")
        args += [buscar] * 3
    with conn.cursor() as cur:
        cur.execute(sql + (f" LIMIT {int(limite)}" if limite else ""), args)
        return cur.fetchall()


def contar(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM analisis WHERE relevante AND NOT manual AND criterio IS DISTINCT FROM %s", (CRITERIO,))
        return cur.fetchone()[0]


def calificar(lote):
    texto = "\n\n".join(
        f"id: {i}\nDocumento: {doc}\nEntidad o proponente: {ent[:200]}\nSumilla: {sum_[:600]}\n"
        f"En qué consiste: {res[:700]}\nQué cambia: {cam[:500]}\nComentario: {com[:500]}"
        for i, _, doc, ent, sum_, res, cam, com, *_ in lote)
    datos, _ = gemini.generar_json(INSTR, texto, ESQUEMA, MODELOS, 8192)
    salida = {}
    docs = datos.get("documentos", []) if isinstance(datos, dict) else (datos if isinstance(datos, list) else [])
    validos = {str(x[0]) for x in lote}
    for d in docs:
        if not isinstance(d, dict) or str(d.get("id", "")).strip() not in validos:
            continue
        cal = next((c for c in CALIFICACIONES if str(d.get("calificacion", "")).strip().lower() == c.lower()), None)
        rel = d.get("relevante")
        if cal is None or not isinstance(rel, bool):
            continue
        rel = rel and d.get("acto_individual") is not True   # acto sobre una empresa o contrato concreto: fuera
        salida[int(str(d["id"]).strip())] = (rel, cal, entero_1_10(d.get("puntaje"), 5))
    return salida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-minutos", type=float, default=50)
    ap.add_argument("--contar", action="store_true")
    ap.add_argument("--buscar", help="solo los documentos que mencionan esta expresion (tanda pequeña)")
    a = ap.parse_args()
    conn = db.conectar()   # aplica las etapas pendientes del esquema (columnas puntaje y criterio)
    if a.contar:
        print(0 if cupos.principal_agotada() else contar(conn))
        return
    # Una tanda pequeña (--buscar) sigue aunque la base principal este frenada: lee muy pocos datos
    if cupos.principal_agotada() and not a.buscar:
        return
    gemini.verificar_clave()
    fin = time.time() + a.max_minutos * 60
    # Solo los que alcanzan a recalificarse en esta tanda (unos 15 por minuto): no se lee todo lo pendiente
    filas = pendientes(conn, limite=1000, buscar=a.buscar)
    print(f"Por recalificar: {len(filas)}")
    hechos = fuera = fallos = 0
    for i in range(0, len(filas), LOTE):
        if time.time() > fin - 120:
            break
        lote = filas[i:i + LOTE]
        # Normas municipales y regionales: fuera del reporte, sin consultar a la IA
        locales = [f for f in lote if f[1] == "N" and es_local(f[8], f[9], f[10])]
        if locales:
            with conn.cursor() as cur:
                for f in locales:
                    cur.execute("UPDATE analisis SET relevante = FALSE, criterio = %s WHERE id = %s", (CRITERIO, f[0]))
            conn.commit()
            hechos += len(locales)
            fuera += len(locales)
        lote = [f for f in lote if f not in locales]
        if not lote:
            continue
        try:
            r = calificar(lote)
        except gemini.ErrorGemini as e:
            print(f"  la IA no respondio: {str(e)[:200]}")
            fallos += 1
            if fallos >= 3:
                break
            time.sleep(60)
            continue
        with conn.cursor() as cur:
            for aid, (rel, cal, pun) in r.items():
                cur.execute("""UPDATE analisis SET relevante = %s, calificacion = %s, puntaje = %s, impacto = %s,
                                      criterio = %s WHERE id = %s""", (rel, cal, pun, impacto_de(pun), CRITERIO, aid))
                hechos += 1
                fuera += not rel
        conn.commit()
        print(f"  {hechos} recalificados ({fuera} salen del reporte)")
    conn.close()
    print(f"Listo en esta ejecucion: {hechos} recalificados, {fuera} salen del reporte.")


if __name__ == "__main__":
    main()
