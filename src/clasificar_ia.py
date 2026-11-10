"""Rubro con IA (Lite) para las normas y los proyectos de ley que las reglas no pudieron clasificar.

    python src/clasificar_ia.py --max-consultas 300

- Grupos de 40 normas por consulta; como maximo --max-consultas por ejecucion (para no quitar cupo de la IA
  al monitoreo ni al usuario).
- Cada norma o proyecto revisado queda marcado (rubro_ia): no se vuelve a preguntar, aunque la IA no le
  encuentre rubro. Primero las normas y, con lo que quede de consultas, los proyectos de ley.
- Primero las mas recientes.
"""
import argparse
import time

import cupos
import db
import gemini
from classifier import RUBROS

LOTE = 40
OPCIONES = [r for r, _ in RUBROS]
INSTR = ("Eres documentalista juridico en el Peru. Para cada norma legal (id, tipo, entidad y sumilla) elige el "
         "rubro tematico que mejor la describe, de esta lista exacta: " + "; ".join(OPCIONES) +
         ". Si ninguno corresponde, responde \"Sin clasificar\". Responde solo con el JSON pedido, un elemento "
         "por cada id recibido.")
ESQUEMA = {"type": "OBJECT", "properties": {"normas": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
    "id": {"type": "STRING"}, "rubro": {"type": "STRING"}}, "required": ["id", "rubro"]}}}, "required": ["normas"]}


INSTR_P = ("Eres documentalista juridico en el Peru. Para cada proyecto de ley del Congreso (id y titulo) elige el "
           "rubro tematico que mejor lo describe, de esta lista exacta: " + "; ".join(OPCIONES) +
           ". Si ninguno corresponde, responde \"Sin clasificar\". Responde solo con el JSON pedido, un elemento "
           "por cada id recibido.")

# tabla -> (instrucciones, consulta de pendientes, como armar cada linea)
TABLAS = {
    "normas": (INSTR, """SELECT id, coalesce(tipo, '') || ' | ' || left(coalesce(entidad, ''), 120) || ' | '
                                 || left(coalesce(sumilla, ''), 500)
                          FROM normas WHERE rubro = 'Sin clasificar' AND NOT rubro_ia ORDER BY fecha DESC, id DESC"""),
    "proyectos_ley": (INSTR_P, """SELECT id, left(coalesce(titulo, ''), 600) FROM proyectos_ley
                                  WHERE rubro = 'Sin clasificar' AND NOT rubro_ia
                                  ORDER BY fecha_presentacion DESC NULLS LAST, id DESC"""),
}


def clasificar_tabla(tabla, max_consultas, fin):
    """Devuelve cuantas consultas a la IA uso."""
    instr, consulta = TABLAS[tabla]
    c = db.conectar()
    with c.cursor() as cur:
        cur.execute(consulta + " LIMIT %s", (max_consultas * LOTE,))
        filas = cur.fetchall()
        cur.execute(f"SELECT count(*) FROM {tabla} WHERE rubro = 'Sin clasificar' AND NOT rubro_ia")
        pendientes = cur.fetchone()[0]
    c.commit()
    c.close()
    nombre = "Normas" if tabla == "normas" else "Proyectos de ley"
    print(f"{nombre} sin rubro por revisar con IA: {pendientes}; en esta ejecucion: {len(filas)}")
    clasificadas = revisadas = fallas = consultas = 0
    validos = {o.lower(): o for o in OPCIONES}
    for i in range(0, len(filas), LOTE):
        if time.time() > fin:
            break
        lote = filas[i:i + LOTE]
        texto = "\n".join(f"{n} | {t}" for n, t in lote)
        consultas += 1
        try:
            datos, _ = gemini.generar_json(instr, texto, ESQUEMA, gemini.modelos_lite(), 4096)
        except gemini.ErrorGemini as e:
            print(f"  la IA no respondio: {str(e)[:200]}")
            fallas += 1
            if fallas >= 3:
                break
            continue
        ids = {str(n) for n, _ in lote}
        respuesta = {}
        for d in (datos.get("normas") or []) if isinstance(datos, dict) else []:
            if isinstance(d, dict) and str(d.get("id", "")).strip() in ids:
                respuesta[int(str(d["id"]).strip())] = validos.get(str(d.get("rubro", "")).strip().lower())
        c = db.conectar()
        with c.cursor() as cur:
            for nid, rubro in respuesta.items():
                if rubro and rubro != "Sin clasificar":
                    cur.execute(f"UPDATE {tabla} SET rubro = %s, rubro_ia = TRUE WHERE id = %s", (rubro, nid))
                    clasificadas += 1
                else:
                    cur.execute(f"UPDATE {tabla} SET rubro_ia = TRUE WHERE id = %s", (nid,))
                revisadas += 1
        c.commit()
        c.close()
    print(f"{nombre}: revisados con IA {revisadas}; con rubro asignado: {clasificadas}; "
          f"quedan por revisar: {pendientes - revisadas}")
    return consultas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-consultas", type=int, default=300)
    ap.add_argument("--max-minutos", type=float, default=50)
    a = ap.parse_args()
    if cupos.principal_agotada():
        return
    gemini.verificar_clave()
    fin = time.time() + a.max_minutos * 60
    usadas = clasificar_tabla("normas", a.max_consultas, fin)
    if a.max_consultas - usadas > 0 and time.time() < fin:
        clasificar_tabla("proyectos_ley", a.max_consultas - usadas, fin)


if __name__ == "__main__":
    main()
