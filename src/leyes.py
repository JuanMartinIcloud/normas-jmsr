"""Proposiciones convertidas en ley: une cada proposicion con la ley que salio de ella (y su fe de
erratas) y con el mismo expediente en la otra camara (Diputados <-> Senado).

    python src/leyes.py [--max-minutos 20]

1. Lee el seguimiento del Congreso: el paso "Publicada en el Diario Oficial El Peruano" dice el numero
   ("LEY N° 32743 - ..."). Se guarda en proyectos_ley (ley_tipo, ley_numero, ley_fecha).
2. Proposiciones publicadas de periodos anteriores sin ese paso guardado: se consulta su expediente en el
   Congreso (solo se guarda el paso de publicacion).
3. Busca la ley y sus fe de erratas entre las normas de El Peruano (ley_docs: enlaces).
4. Cada camara tiene su propio numero para la misma iniciativa: el Senado recibe de Diputados un
   expediente nuevo. Se unen (enlace_id) y cada registro muestra el estado y la ley del otro.
"""
import argparse
import re
import time
import unicodedata
from datetime import datetime

from psycopg2.extras import Json, execute_values

import db
from seguimiento import PAUSA, enlace_de, expediente

_LEY = re.compile(
    r"^\W*(LEY|RESOLUCI[ÓO]N\s+LEGISLATIVA(?:\s+DEL\s+(SENADO|CONGRESO)(?:\s+DE\s+LA\s+REP[ÚU]BLICA)?)?)"
    r"\s*(?:N\s*[°º.o]*\s*)?(?:RLC?-)?(\d+(?:-\d{4}-\d{4}(?:-[A-Z]+)?)?)", re.I)
_ERRATA = re.compile(r"^\W*FE\s+DE\s+ERRATAS?", re.I)
PUBLICADA = "s.estado ILIKE 'publicad%'"


def ley_de(detalle):
    """('Ley', '32743') desde el detalle del paso de publicacion; None si no trae numero."""
    t = (detalle or "").strip()
    if not t or _ERRATA.match(t):
        return None
    m = _LEY.match(t)
    if not m:
        return None
    if m.group(1).upper().startswith("LEY"):
        tipo = "Ley"
    else:
        tipo = "Resolución Legislativa" + (" del Senado" if (m.group(2) or "").upper() == "SENADO" else "")
    return tipo, m.group(3).upper()


def leyes_de_seguimientos(cur):
    """Paso 1: numero de ley de las proposiciones con el paso de publicacion ya guardado."""
    cur.execute(f"""SELECT s.proyecto_id, (s.fecha AT TIME ZONE 'America/Lima')::date, s.detalle
                    FROM seguimientos s JOIN proyectos_ley p ON p.id = s.proyecto_id
                    WHERE {PUBLICADA} AND p.ley_numero IS NULL ORDER BY s.fecha""")
    hallados = {}
    for pid, fecha, detalle in cur.fetchall():
        r = ley_de(detalle)
        if r and pid not in hallados:
            hallados[pid] = (*r, fecha)
    for pid, (tipo, num, fecha) in hallados.items():
        cur.execute("UPDATE proyectos_ley SET ley_tipo = %s, ley_numero = %s, ley_fecha = %s WHERE id = %s",
                    (tipo, num, fecha, pid))
    return len(hallados)


def completar_antiguas(conn, fin):
    """Paso 2: proposiciones publicadas sin el paso de publicacion guardado (sobre todo del periodo
    2021-2026): se lee su expediente y se guarda solo ese paso."""
    with conn.cursor() as cur:
        cur.execute(f"""SELECT p.id, p.periodo, p.camara, p.num_pley FROM proyectos_ley p
                        WHERE p.estado ILIKE 'publicad%' AND p.ley_numero IS NULL AND p.num_pley IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM seguimientos s WHERE s.proyecto_id = p.id AND {PUBLICADA})
                          AND (p.seguimiento_revisado IS NULL OR p.seguimiento_revisado < now() - interval '30 days')
                        ORDER BY p.fecha_presentacion DESC NULLS LAST""")
        pendientes = cur.fetchall()
    conn.commit()
    print(f"Proposiciones publicadas sin numero de ley: {len(pendientes)}")
    hechos = 0
    filas, revisados = [], []

    def guardar():
        nonlocal filas, revisados
        with conn.cursor() as cur:
            if filas:
                execute_values(cur, """INSERT INTO seguimientos (id, proyecto_id, fecha, camara, estado, comisiones, detalle)
                                       VALUES %s ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado,
                                         detalle = EXCLUDED.detalle, fecha = EXCLUDED.fecha""", filas)
            if revisados:
                cur.execute("UPDATE proyectos_ley SET seguimiento_revisado = now() WHERE id = ANY(%s)", (revisados,))
        conn.commit()
        filas, revisados = [], []

    for pid, periodo, camara, num in pendientes:
        if time.time() > fin:
            break
        e = expediente(periodo, camara, num)
        if e is None:
            continue
        for s in e.get("seguimientos") or []:
            if not str(s.get("desEstado") or "").strip().lower().startswith("publicad"):
                continue
            sid, fecha = s.get("seguimientoPleyId"), s.get("fecha")
            if sid and fecha:
                filas.append((sid, pid, datetime.fromisoformat(fecha.replace("Z", "+00:00")),
                              (s.get("codTipoParl") or camara or "C")[:1], s["desEstado"].strip(), None,
                              (s.get("detalle") or s.get("observacion") or "").strip() or None))
        revisados.append(pid)
        hechos += 1
        if hechos % 50 == 0:
            guardar()
            print(f"  {hechos} expedientes leidos")
        time.sleep(PAUSA)
    guardar()
    return hechos


def enlazar_camaras(conn, fin):
    """Proposiciones recibidas de la otra camara aun sin enlace (el seguimiento diario tambien lo hace)."""
    with conn.cursor() as cur:
        cur.execute("""SELECT id, periodo, camara, num_pley FROM proyectos_ley
                       WHERE enlace_id IS NULL AND camara IN ('D', 'S') AND num_pley IS NOT NULL
                         AND titulo ~* '^\\W*PROPUESTA LEGISLATIVA REMITIDA'""")
        filas = cur.fetchall()
    conn.commit()
    n = 0
    for pid, periodo, camara, num in filas:
        if time.time() > fin:
            break
        e = expediente(periodo, camara, num)
        otro = enlace_de(e or {}, camara)
        if not otro:
            continue
        with conn.cursor() as cur:
            cur.execute("""UPDATE proyectos_ley p SET enlace_id = o.id FROM proyectos_ley o
                           WHERE p.id = %s AND o.camara = %s AND o.periodo = %s AND o.num_pley = %s RETURNING o.id""",
                        (pid, *otro))
            for (oid,) in cur.fetchall():
                cur.execute("UPDATE proyectos_ley SET enlace_id = %s WHERE id = %s AND enlace_id IS NULL", (pid, oid))
                n += 1
        conn.commit()
        time.sleep(PAUSA)
    return n


def _sin_tildes(t):
    return unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().upper()


def _rl(a, b, c):
    """Numero de resolucion legislativa uniforme: 3-2021-2022 -> 003-2021-2022."""
    return f"{int(a):03d}-{b}-{c}"


def claves_norma(tipo, numero):
    """(es_fe_de_erratas, [(clase, numero, del_senado)]) de una norma de El Peruano.
    El Peruano escribe el numero de varias formas: «003-2021-2022-CR», «Resolucion Legislativa 010-2021-2022-Cr»
    (todo en el tipo), «Leyes 31365, 31366 y 31367» (varias en una publicacion). Se reconocen todas."""
    t = re.sub(r"\s+", " ", _sin_tildes(f"{tipo or ''} {numero or ''}")).strip()
    errata = bool(re.match(r"^\W*FE DE ERRATAS?", t))
    cuerpo = re.sub(r"^\W*FE DE ERRATAS?\s*(DE\s+(LA\s+)?)?", "", t)
    if re.match(r"^\W*LEY(ES)?\b", cuerpo):
        return errata, [("LEY", n, False) for n in re.findall(r"\b(\d{5})\b", cuerpo)]
    # A veces El Peruano omite «Legislativa»: «Resolucion 020-2022-2023-CR» (sin la -P de las resoluciones
    # de la Presidencia del Congreso, que son «...-P-CR» o «...-P/CR»)
    m = re.match(r"^\W*RESOLUCION\s+(?:N\S*\s*)?(\d{1,4})-(\d{4})-(\d{4})-CR\b", cuerpo)
    if m:
        return errata, [("RL", _rl(*m.groups()), False)]
    if re.match(r"^\W*RESOLUCION(ES)? LEGISLATIVAS?\b", cuerpo):
        senado = "SENADO" in cuerpo or bool(re.search(r"\d{4}-\d{4}-S\b", cuerpo))
        claves = [("RL", _rl(*m), senado) for m in re.findall(r"\b(\d{1,4})-(\d{4})-(\d{4})\b", cuerpo)]
        # Resoluciones legislativas antiguas, numeradas como las leyes (por ejemplo «N° 31347»)
        claves += [("RL", n, False) for n in re.findall(r"(?<![\d-])(\d{5})(?![\d-])", cuerpo)]
        return errata, claves
    return errata, []


def clave_proyecto(ley_tipo, ley_numero):
    """(clase, numero, del_senado) de la ley que salio de una proposicion (o None)."""
    t, n = _sin_tildes(ley_tipo), _sin_tildes(ley_numero)
    if t.startswith("LEY"):
        m = re.search(r"\d{5}", n)
        return ("LEY", m.group(0), False) if m else None
    m = re.search(r"(\d{1,4})-(\d{4})-(\d{4})", n)
    if m:
        return ("RL", _rl(*m.groups()), "SENADO" in t or n.endswith("-S"))
    m = re.fullmatch(r"\d{5}", n.strip())
    return ("RL", m.group(0), False) if m else None


def documentos_de_leyes(cur):
    """Paso 3: la ley y sus fe de erratas en las normas de El Peruano (enlaces para la web)."""
    cur.execute("""SELECT id, ley_tipo, ley_numero, ley_docs FROM proyectos_ley
                   WHERE ley_numero IS NOT NULL
                     AND (ley_docs IS NULL OR ley_docs->'ley' IS NULL OR ley_fecha >= current_date - 120)""")
    proyectos = cur.fetchall()
    if not proyectos:
        return 0
    # Leyes, resoluciones legislativas y sus fe de erratas publicadas en El Peruano
    cur.execute("""SELECT id, fecha::text, tipo, coalesce(numero, ''), url_detalle FROM normas
                   WHERE translate(lower(tipo), 'áéíóú', 'aeiou')
                         ~ '^\\W*(fe de erratas?\\s+(de\\s+(la\\s+)?)?)?(ley(es)?|resolucion(es)? legislativas?)\\y'
                      OR (entidad ILIKE 'CONGRESO%%' AND translate(lower(tipo || ' ' || coalesce(numero, '')), 'áéíóú', 'aeiou')
                          ~ '^\\W*resolucion\\s+\\d{1,4}-\\d{4}-\\d{4}-cr\\y')
                   ORDER BY fecha, id""")
    por_clave = {}
    for nid, fecha, tipo, numero, url in cur.fetchall():
        errata, claves = claves_norma(tipo, numero)
        for clave in claves:
            d = por_clave.setdefault(clave, {"ley": None, "erratas": []})
            doc = {"id": nid, "fecha": fecha, "tipo": tipo, "url": url}
            if errata:
                d["erratas"].append(doc)
            elif d["ley"] is None:
                d["ley"] = doc
    cambios = 0
    for pid, ley_tipo, ley_numero, actual in proyectos:
        clave = clave_proyecto(ley_tipo, ley_numero)
        nuevo = por_clave.get(clave) if clave else None
        if not nuevo or nuevo == actual:
            continue
        fecha = nuevo["ley"]["fecha"] if nuevo["ley"] else None
        cur.execute("UPDATE proyectos_ley SET ley_docs = %s, ley_fecha = coalesce(%s::date, ley_fecha) WHERE id = %s",
                    (Json(nuevo), fecha, pid))
        cambios += 1
    return cambios


def propagar(cur):
    """Paso 4: cada registro muestra el estado y la ley de su par en la otra camara."""
    cur.execute("""UPDATE proyectos_ley d SET enlace_numero = s.numero, enlace_camara = s.camara, enlace_estado = s.estado
                   FROM proyectos_ley s
                   WHERE d.enlace_id = s.id
                     AND (d.enlace_numero IS DISTINCT FROM s.numero OR d.enlace_camara IS DISTINCT FROM s.camara
                          OR d.enlace_estado IS DISTINCT FROM s.estado)""")
    a = cur.rowcount
    cur.execute("""UPDATE proyectos_ley d SET ley_tipo = s.ley_tipo, ley_numero = s.ley_numero,
                          ley_fecha = s.ley_fecha, ley_docs = s.ley_docs
                   FROM proyectos_ley s
                   WHERE d.enlace_id = s.id AND s.ley_numero IS NOT NULL
                     AND (d.ley_numero IS NULL OR d.ley_numero = s.ley_numero)
                     AND (d.ley_numero IS DISTINCT FROM s.ley_numero OR d.ley_fecha IS DISTINCT FROM s.ley_fecha
                          OR d.ley_docs::text IS DISTINCT FROM s.ley_docs::text)""")
    return a, cur.rowcount


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-minutos", type=float, default=20)
    a = ap.parse_args()
    fin = time.time() + a.max_minutos * 60
    conn = db.conectar()   # aplica la etapa 8 del esquema si falta
    with conn.cursor() as cur:
        n1 = leyes_de_seguimientos(cur)
    conn.commit()
    leidos = completar_antiguas(conn, fin)
    with conn.cursor() as cur:
        n2 = leyes_de_seguimientos(cur)
    conn.commit()
    enlaces = enlazar_camaras(conn, fin)
    with conn.cursor() as cur:
        docs = documentos_de_leyes(cur)
        estados, leyes = propagar(cur)
        docs += documentos_de_leyes(cur)
        cur.execute("SELECT count(*), count(*) FILTER (WHERE ley_docs->'ley' IS NOT NULL) FROM proyectos_ley WHERE ley_numero IS NOT NULL")
        total, con_norma = cur.fetchone()
    conn.commit()
    conn.close()
    print(f"Numeros de ley hallados: {n1 + n2} (expedientes leidos: {leidos}); camaras enlazadas: {enlaces}; "
          f"enlaces a normas actualizados: {docs}; estados copiados: {estados}; leyes copiadas: {leyes}")
    print(f"Proposiciones convertidas en ley: {total} ({con_norma} con la norma hallada en El Peruano)")


if __name__ == "__main__":
    main()
