"""Resumen diario con IA (Gemini) de las normas legales y de los proyectos de ley.

    python src/resumen.py                  # resume el dia de ayer (hora de Lima) y rellena
                                           # los dias sin resumen de la ultima semana
    python src/resumen.py 2026-10-11       # resume una fecha concreta
    python src/resumen.py 2026-10-11 --forzar      # lo rehace aunque ya exista
    python src/resumen.py --sin-ia         # muestra lo que se enviaria a Gemini, sin guardar
    python src/resumen.py --sin-descarga   # no vuelve a descargar El Peruano

Pasos:
1. Si el dia ya tiene resumen, termina sin hacer nada (asi los intentos de respaldo no gastan).
2. Vuelve a descargar las normas de ese dia (recoge ediciones extraordinarias tardias).
3. Envia a Gemini las sumillas de las normas, los proyectos nuevos y los que cambiaron de estado.
4. Guarda el resumen en la tabla 'resumenes'; la pagina web lo muestra al abrirla.
"""
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone

from psycopg2.extras import Json, RealDictCursor

import db
import elperuano
import gemini

DIAS_ATRAS = 7            # cuantos dias hacia atras se rellenan si faltan resumenes
MAX_NORMAS = 400
MAX_PROYECTOS = 250
MAX_CAMBIOS = 200
LARGO_SUMILLA = 600
LARGO_TITULO = 400

RANGO_DE_LEY = ("ley", "decreto legislativo", "decreto de urgencia", "resolucion legislativa")
NIVEL = {"Gobiernos Regionales": 2, "Gobiernos Locales": 3}


def hoy_lima() -> date:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def es_rango_de_ley(tipo: str) -> bool:
    t = _norm(tipo)
    return any(t == r or t.startswith(r + " ") for r in RANGO_DE_LEY)


# --------------------------------------------------------------------------- datos


def dias_sin_resumen(conn, desde: date, hasta: date) -> list[date]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT d::date FROM generate_series(%s::date, %s::date, interval '1 day') d
               WHERE d::date NOT IN (SELECT fecha FROM resumenes) ORDER BY 1""",
            (desde, hasta),
        )
        return [r[0] for r in cur.fetchall()]


def normas_del_dia(conn, fecha: date) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT id, tipo, numero, entidad, sector, rubro, sumilla, extraordinaria
               FROM normas WHERE fecha = %s ORDER BY id""",
            (fecha,),
        )
        filas = cur.fetchall()
    # Primero las de rango de ley, luego gobierno central, regional y local
    filas.sort(key=lambda n: (0 if es_rango_de_ley(n["tipo"]) else 1, NIVEL.get(n["sector"], 1), n["id"]))
    return filas


def estado_descarga(conn, fecha: date):
    with conn.cursor() as cur:
        cur.execute("SELECT estado FROM descargas WHERE fecha = %s", (fecha,))
        fila = cur.fetchone()
    return fila[0] if fila else None


def ventana(conn, fecha: date):
    """Rango de tiempo para detectar proyectos nuevos y cambios de estado.

    Empieza donde termino el resumen anterior; asi cada novedad aparece una sola vez.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT now()")
        hasta = cur.fetchone()[0]
        cur.execute("SELECT max(ventana_hasta) FROM resumenes WHERE fecha < %s", (fecha,))
        desde = cur.fetchone()[0]
    if desde is None or desde >= hasta:
        desde = hasta - timedelta(hours=30)
    return desde, hasta


def proyectos_nuevos(conn, fecha: date, desde=None, hasta=None) -> list[dict]:
    """Presentados ese dia, mas (si hay ventana) los que aparecieron tarde en el portal."""
    consulta = """SELECT id, numero, camara, fecha_presentacion::text AS fecha, titulo,
                         proponente, autor, estado
                  FROM proyectos_ley WHERE fecha_presentacion = %(f)s"""
    if desde is not None:
        consulta += """ OR (creado_en > %(desde)s AND creado_en <= %(hasta)s
                            AND fecha_presentacion < %(f)s
                            AND fecha_presentacion >= %(f)s::date - 60)"""
    consulta += " ORDER BY fecha DESC, id DESC LIMIT %(lim)s"
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(consulta, {"f": fecha, "desde": desde, "hasta": hasta, "lim": MAX_PROYECTOS + 1})
        return cur.fetchall()


def proyectos_con_cambios(conn, desde, hasta, excluir: set) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT id, numero, camara, fecha_presentacion::text AS fecha, titulo, proponente, estado
               FROM proyectos_ley
               WHERE estado_cambiado_en > %s AND estado_cambiado_en <= %s
               ORDER BY estado_cambiado_en DESC LIMIT %s""",
            (desde, hasta, MAX_CAMBIOS + len(excluir) + 1),
        )
        return [p for p in cur.fetchall() if p["id"] not in excluir][: MAX_CAMBIOS + 1]


def refrescar_fuentes(conn, fechas: list[date]) -> list[str]:
    """Vuelve a descargar El Peruano (recoge ediciones extraordinarias tardias). Si algo falla, lo anota
    y sigue. Los proyectos del Congreso ya los actualizo la tarea "Proyectos de ley" una hora antes."""
    avisos = []
    for f in fechas:
        try:
            filas = elperuano.descargar_dia(f)
            nuevas = db.insertar_normas(conn, filas)
            db.marcar_dia(conn, f, "ok" if filas else "vacio", len(filas))
            print(f"{f}: {len(filas)} normas en El Peruano ({nuevas} nuevas)")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"{f}: no se pudo volver a descargar El Peruano: {e}")
            avisos.append("No se pudo revisar El Peruano a última hora; podría faltar alguna norma.")
    return avisos


# --------------------------------------------------------------------------- pedido a Gemini

INSTRUCCIONES = """Eres un asistente de un estudio de abogados en Perú. Cada mañana preparas el resumen
de lo publicado el día anterior en el diario oficial El Peruano y de los proyectos de ley del Congreso.

Reglas:
- Escribe en español claro y profesional, para abogados que necesitan saber rápido qué cambió.
- Básate ÚNICAMENTE en los datos recibidos (sumillas y títulos oficiales). No inventes efectos,
  fechas, montos ni plazos que no estén en el texto. Si una sumilla es muy escueta, dilo con
  prudencia ("según su sumilla, ...").
- Cada elemento se identifica con un código entre corchetes: [N123] para normas y [P45] para
  proyectos. En el campo "refs" pon los códigos de los que hablas, sin corchetes (ej. "N123").
  Usa solo códigos que existan en los datos.
- "panorama": 2 a 4 oraciones con lo más relevante del día.
- "destacadas": las normas de mayor impacto jurídico o general (primero las marcadas
  [RANGO DE LEY]; luego decretos supremos y resoluciones de alcance general). Máximo 10.
  En "explicacion" (2 a 3 oraciones) explica qué dispone y a quién afecta.
- "temas": el resto de normas relevantes agrupadas por tema (tributario, laboral, salud,
  contrataciones, municipal, etc.), con un punto por norma o por grupo de normas similares.
  No repitas lo que ya pusiste en "destacadas".
- "designaciones": una o dos oraciones que agrupen designaciones, renuncias, encargos de
  funciones y autorizaciones de viaje (ej. "Hubo 14 designaciones de funcionarios, principalmente
  en ..."). Si no hay, cadena vacía.
- "proyectos": un punto por proyecto de ley nuevo (o por grupo muy similar): qué propone y
  quién lo presenta. Si no hay, lista vacía.
- "avances": proyectos que cambiaron de estado; resalta los aprobados, autógrafas y los
  publicados como ley. Si no hay, lista vacía.
- Todas las normas recibidas deben quedar cubiertas en "destacadas", "temas" o "designaciones".
- Responde solo con el objeto JSON pedido."""

_PUNTO = {
    "type": "OBJECT",
    "properties": {"texto": {"type": "STRING"}, "refs": {"type": "ARRAY", "items": {"type": "STRING"}}},
    "required": ["texto", "refs"],
}

ESQUEMA = {
    "type": "OBJECT",
    "properties": {
        "panorama": {"type": "STRING"},
        "destacadas": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "titulo": {"type": "STRING"},
                    "explicacion": {"type": "STRING"},
                    "refs": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["titulo", "explicacion", "refs"],
            },
        },
        "temas": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {"tema": {"type": "STRING"}, "puntos": {"type": "ARRAY", "items": _PUNTO}},
                "required": ["tema", "puntos"],
            },
        },
        "designaciones": {"type": "STRING"},
        "proyectos": {"type": "ARRAY", "items": _PUNTO},
        "avances": {"type": "ARRAY", "items": _PUNTO},
    },
    "required": ["panorama", "destacadas", "temas", "designaciones", "proyectos", "avances"],
}


def _corta(texto, n):
    texto = " ".join((texto or "").split())
    return texto if len(texto) <= n else texto[: n - 1] + "…"


def armar_contenido(fecha: date, normas, nuevos, cambios) -> str:
    lineas = [f"FECHA DE PUBLICACIÓN: {fecha.isoformat()}", "", f"NORMAS LEGALES ({len(normas)}):"]
    for n in normas[:MAX_NORMAS]:
        marcas = []
        if es_rango_de_ley(n["tipo"]):
            marcas.append("[RANGO DE LEY]")
        if n["extraordinaria"]:
            marcas.append("[EDICIÓN EXTRAORDINARIA]")
        nombre = " N° ".join(x for x in [n["tipo"], n["numero"]] if x)
        cabeza = " ".join([f"[N{n['id']}]"] + marcas + [nombre])
        lineas.append(
            f"{cabeza} | {n['entidad'] or ''} | rubro: {n['rubro'] or '-'} | "
            f"{_corta(n['sumilla'], LARGO_SUMILLA)}"
        )
    if len(normas) > MAX_NORMAS:
        lineas.append(f"(y {len(normas) - MAX_NORMAS} normas más que no se incluyen por espacio)")
    if not normas:
        lineas.append("(ninguna)")

    lineas += ["", f"PROYECTOS DE LEY NUEVOS ({len(nuevos)}):"]
    for p in nuevos[:MAX_PROYECTOS]:
        lineas.append(
            f"[P{p['id']}] {p['numero']} | presentado {p['fecha']} | {p['proponente'] or ''} | "
            f"autores: {_corta(p['autor'], 150) or '-'} | estado: {p['estado'] or '-'} | "
            f"{_corta(p['titulo'], LARGO_TITULO)}"
        )
    if not nuevos:
        lineas.append("(ninguno)")

    lineas += ["", f"PROYECTOS QUE CAMBIARON DE ESTADO ({len(cambios)}):"]
    for p in cambios[:MAX_CAMBIOS]:
        lineas.append(
            f"[P{p['id']}] {p['numero']} | nuevo estado: {p['estado'] or '-'} | "
            f"{_corta(p['titulo'], LARGO_TITULO)}"
        )
    if not cambios:
        lineas.append("(ninguno)")
    return "\n".join(lineas)


def _limpiar_refs(refs, validas: set) -> list[str]:
    salida = []
    for r in refs or []:
        r = str(r).strip().strip("[]").upper()
        if r in validas and r not in salida:
            salida.append(r)
    return salida


def validar(datos: dict, validas: set) -> dict:
    """Deja el resultado en la forma exacta que espera la web, descartando codigos inventados."""
    def puntos(lista):
        out = []
        for p in lista or []:
            if isinstance(p, dict) and str(p.get("texto", "")).strip():
                out.append({"texto": str(p["texto"]).strip(), "refs": _limpiar_refs(p.get("refs"), validas)})
        return out

    destacadas = []
    for d in datos.get("destacadas") or []:
        if isinstance(d, dict) and (d.get("titulo") or d.get("explicacion")):
            destacadas.append({
                "titulo": str(d.get("titulo") or "").strip(),
                "explicacion": str(d.get("explicacion") or "").strip(),
                "refs": _limpiar_refs(d.get("refs"), validas),
            })
    temas = []
    for t in datos.get("temas") or []:
        if isinstance(t, dict) and puntos(t.get("puntos")):
            temas.append({"tema": str(t.get("tema") or "Otros").strip(), "puntos": puntos(t.get("puntos"))})
    return {
        "panorama": str(datos.get("panorama") or "").strip(),
        "destacadas": destacadas,
        "temas": temas,
        "designaciones": str(datos.get("designaciones") or "").strip(),
        "proyectos": puntos(datos.get("proyectos")),
        "avances": puntos(datos.get("avances")),
    }


def guardar(conn, fecha, datos, modelo, n_normas, n_proy, n_camb, desde, hasta):
    # Conexion nueva: mientras Gemini escribe (puede tardar minutos) Neon apaga la base y corta
    # la conexion anterior
    conn = db.conectar()
    try:
        _guardar(conn, fecha, datos, modelo, n_normas, n_proy, n_camb, desde, hasta)
    finally:
        conn.close()


def _guardar(conn, fecha, datos, modelo, n_normas, n_proy, n_camb, desde, hasta):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO resumenes (fecha, datos, modelo, n_normas, n_proyectos, n_cambios,
                                      ventana_desde, ventana_hasta)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (fecha) DO UPDATE SET
                   datos = EXCLUDED.datos, modelo = EXCLUDED.modelo, n_normas = EXCLUDED.n_normas,
                   n_proyectos = EXCLUDED.n_proyectos, n_cambios = EXCLUDED.n_cambios,
                   ventana_desde = EXCLUDED.ventana_desde, ventana_hasta = EXCLUDED.ventana_hasta,
                   creado_en = now()""",
            (fecha, Json(datos), modelo, n_normas, n_proy, n_camb, desde, hasta),
        )
    conn.commit()


def resumir_dia(conn, fecha: date, con_ventana: bool, avisos: list[str], sin_ia: bool) -> None:
    normas = normas_del_dia(conn, fecha)
    desde = hasta = None
    if con_ventana:
        desde, hasta = ventana(conn, fecha)
    nuevos = proyectos_nuevos(conn, fecha, desde, hasta)
    cambios = proyectos_con_cambios(conn, desde, hasta, {p["id"] for p in nuevos}) if con_ventana else []
    print(f"{fecha}: {len(normas)} normas, {len(nuevos)} proyectos nuevos, {len(cambios)} cambios de estado")

    contenido = armar_contenido(fecha, normas, nuevos, cambios)
    if sin_ia:
        print("----- texto que se enviaria a Gemini -----")
        print(contenido)
        return

    if not normas and estado_descarga(conn, fecha) not in ("ok", "vacio"):
        # Sin normas y sin constancia de que El Peruano se reviso: no se afirma que "no hubo normas"
        raise gemini.ErrorGemini("No hay normas guardadas de ese dia y su descarga no esta confirmada; "
                                 "se reintentara en la siguiente ejecucion")
    if not normas and not nuevos and not cambios:
        datos = validar({"panorama": "No se publicaron normas legales ni hubo novedades en proyectos de ley."}, set())
        modelo = None
    else:
        validas = {f"N{n['id']}" for n in normas[:MAX_NORMAS]}
        validas |= {f"P{p['id']}" for p in nuevos[:MAX_PROYECTOS] + cambios[:MAX_CAMBIOS]}
        crudo, modelo = gemini.generar_json(INSTRUCCIONES, contenido, ESQUEMA)
        datos = validar(crudo, validas)
        if not datos["panorama"] and not datos["destacadas"] and not datos["temas"]:
            raise gemini.ErrorGemini("Gemini devolvio un resumen vacio")
    if avisos:
        datos["avisos"] = avisos
    guardar(conn, fecha, datos, modelo, len(normas), len(nuevos), len(cambios), desde, hasta)
    print(f"{fecha}: resumen guardado (modelo {modelo or 'ninguno'})")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    forzar = "--forzar" in sys.argv
    sin_ia = "--sin-ia" in sys.argv
    sin_descarga = "--sin-descarga" in sys.argv

    ayer = hoy_lima() - timedelta(days=1)
    conn = db.conectar()
    try:
        if args:
            objetivo = date.fromisoformat(args[0])
            falta = bool(dias_sin_resumen(conn, objetivo, objetivo))
            dias = [objetivo] if (falta or forzar or sin_ia) else []
        else:
            objetivo = ayer
            dias = dias_sin_resumen(conn, ayer - timedelta(days=DIAS_ATRAS - 1), ayer)
            if forzar or sin_ia:
                dias = sorted(set(dias) | {ayer})
        if not dias:
            print(f"El resumen de {objetivo} ya existe; no hay nada que hacer.")
            return

        if not sin_ia:
            try:
                gemini.verificar_clave()
            except gemini.ErrorGemini as e:
                raise SystemExit(str(e))
        print("Dias a resumir:", ", ".join(d.isoformat() for d in dias))
        avisos = [] if sin_descarga else refrescar_fuentes(conn, dias)

        fallas = []
        for i, d in enumerate(dias):
            if i and not sin_ia:
                time.sleep(15)   # respeta el limite por minuto de la capa gratuita
            # Conexion nueva por dia (la anterior pudo cerrarse mientras la base estaba apagada)
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = db.conectar()
            try:
                # Solo el resumen de ayer incluye los proyectos aparecidos tarde y los cambios de estado
                resumir_dia(conn, d, con_ventana=(d == ayer),
                            avisos=avisos if d == ayer else [], sin_ia=sin_ia)
            except gemini.ErrorGemini as e:
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001
                    pass
                fallas.append(f"{d}: {e}")
                print(f"{d}: ERROR {e}")
        if fallas:
            raise SystemExit("No se pudieron generar estos resumenes:\n" + "\n".join(fallas))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
