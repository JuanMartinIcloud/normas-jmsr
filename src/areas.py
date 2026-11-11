"""Monitoreo por areas (minería, agro, economía, etc.).

Cada documento (norma legal o proyecto de ley) se revisa UNA vez para todas las areas pendientes:
1. Filtro con IA, por lotes de 40, leyendo tipo, numero, entidad y sumilla: ¿a que areas afecta?
2. Para cada documento que afecta a alguna area, analisis con IA leyendo el texto completo: un resumen
   general y, para cada area, si de verdad la afecta, calificacion (Favorable / Desfavorable / Para
   seguimiento), puntaje de impacto de 1 a 10 y comentario.
Que documentos ya se revisaron para que areas queda en area_cobertura (una fila por documento); el analisis
de los que afectan a un area, en area_revision. La web arma el reporte de cada area con ellas.

    python src/areas.py diario      # pedidos de la web + mes en curso (y el anterior los primeros dias) + historial
    python src/areas.py pedidos     # solo los pedidos de la web («Revisar este mes»)
    python src/areas.py historico   # meses anteriores, del mas reciente al mas antiguo (hasta 2015)
    python src/areas.py rango 2026-08-01 2026-08-31
Opciones: --max-minutos 300
"""
import argparse
import os
import re
import time
import unicodedata
from datetime import date, timedelta

import psycopg2
from psycopg2.extras import execute_values

import bases
import cupos
import db
import gemini
from areas_base import AREAS_BASE
from textos import pdf_norma, texto_pdf

LOTE_FILTRO = 40
MAX_TEXTO = 25000
INICIO_HISTORIAL = date(2015, 1, 1)
CALIFICACIONES = ["Favorable", "Desfavorable", "Para seguimiento"]
# Modelos de IA: SOLO los Flash (los mas potentes que da gratis Google; los Pro no tienen cupo gratuito y los
# Lite son mas debiles, no se usan para el monitoreo). Cada modelo tiene su propio cupo diario (se renueva a las
# 3:00 de Lima). Si los Flash se agotan, el trabajo espera a la noche siguiente; nunca se usa un modelo mas debil.
# - Mes en curso y pedidos de la web: todos los Flash, del mas nuevo al mas antiguo.
# - Historia (meses anteriores, de a poco cada noche): solo tres Flash anteriores. Cuando esos tres llegan a su
#   limite del dia, la historia se detiene hasta la noche siguiente; asi los Flash mas nuevos quedan libres para
#   los pedidos «Revisar este mes» que alguien haga durante el dia.
MODELOS_MES = list(gemini.FLASH)
MODELOS_HISTORIA = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview"]
MODELOS_PEDIDOS = list(gemini.FLASH)
# Para pruebas: AREAS_MODELOS="modelo1,modelo2" obliga a usar solo esos modelos en todo
if os.getenv("AREAS_MODELOS", "").strip():
    MODELOS_MES = MODELOS_HISTORIA = MODELOS_PEDIDOS = [m.strip() for m in os.environ["AREAS_MODELOS"].split(",") if m.strip()]
MODELOS = MODELOS_MES   # los que se usan en este momento (cambia segun el trabajo)


class Reloj:
    def __init__(self, minutos):
        self.inicio = time.time()
        self.fin = self.inicio + minutos * 60

    def minutos(self):
        return (time.time() - self.inicio) / 60

    def queda(self, margen=60):
        return time.time() < self.fin - margen


class SinRespuesta(Exception):
    """La IA no respondio (cupo agotado o saturada): se sigue en la proxima ejecucion."""


# --------------------------------------------------------------------------- base de datos

def consultar(sql, params=()):
    c = db.conectar()
    with c.cursor() as cur:
        cur.execute(sql, params)
        filas = cur.fetchall() if cur.description else []
    c.commit()
    c.close()
    return filas


def cargar_areas_base():
    """Agrega las areas de la lista base que falten (no toca las existentes)."""
    c = db.conectar()
    with c.cursor() as cur:
        execute_values(cur, """INSERT INTO areas (nombre, descripcion, origen) VALUES %s
                               ON CONFLICT (nombre) DO NOTHING""",
                       [(n, d, "base") for n, d in AREAS_BASE])
    c.commit()
    c.close()


def areas_activas(ids=None):
    """[(id, nombre, descripcion)]"""
    if ids:
        return consultar("SELECT id, nombre, descripcion FROM areas WHERE activa AND id = ANY(%s) ORDER BY id",
                         ([int(x) for x in ids],))
    return consultar("SELECT id, nombre, descripcion FROM areas WHERE activa ORDER BY id")


def guardar_analisis(filas):
    """filas: dicts con tipo, ref_id, area_id, fecha y el analisis (solo documentos que afectan al area)."""
    if not filas:
        return
    cols = ["tipo", "ref_id", "area_id", "fecha", "calificacion", "puntaje", "impacto", "resumen", "cambios",
            "comentario", "lectura", "modelo"]
    c = db.conectar()
    with c.cursor() as cur:
        execute_values(cur, f"""INSERT INTO area_revision ({', '.join(cols)}) VALUES %s
            ON CONFLICT (tipo, ref_id, area_id) DO UPDATE SET
              fecha = EXCLUDED.fecha, calificacion = EXCLUDED.calificacion, puntaje = EXCLUDED.puntaje,
              impacto = EXCLUDED.impacto, resumen = EXCLUDED.resumen, cambios = EXCLUDED.cambios,
              comentario = EXCLUDED.comentario, lectura = EXCLUDED.lectura, modelo = EXCLUDED.modelo,
              creado_en = now()""", [[f.get(k) for k in cols] for f in filas])
    c.commit()
    c.close()


def cubrir(tipo, filas):
    """filas: [(ref_id, fecha, [area_id, ...])]: esos documentos quedan revisados para esas areas.
    Se llama DESPUES de guardar su analisis: si algo se corta en medio, el documento se vuelve a revisar."""
    filas = [(tipo, r, f, sorted(set(a))) for r, f, a in filas if a]
    if not filas:
        return
    c = db.conectar()
    with c.cursor() as cur:
        execute_values(cur, """INSERT INTO area_cobertura (tipo, ref_id, fecha, areas) VALUES %s
            ON CONFLICT (tipo, ref_id) DO UPDATE SET fecha = EXCLUDED.fecha,
              areas = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(area_cobertura.areas || EXCLUDED.areas) x)""",
                       filas, template="(%s, %s, %s, %s::int[])")
    c.commit()
    c.close()


def textos(tipo, claves):
    """{clave: texto} desde las bases de texto (solo los que tienen texto)."""
    salida = {}
    claves = [k for k in claves if k]
    if not claves:
        return salida
    for _, url in bases.bases_texto():
        try:
            c = psycopg2.connect(url, connect_timeout=60)
            cur = c.cursor()
            cur.execute("""SELECT clave, left(texto, %s) FROM documentos
                           WHERE tipo = %s AND clave = ANY(%s) AND estado = 'ok'""", (MAX_TEXTO, tipo, claves))
            for k, t in cur.fetchall():
                salida[k] = t
            c.close()
        except psycopg2.Error as e:
            print(f"  base de texto no disponible: {str(e)[:100]}")
    return salida


# --------------------------------------------------------------------------- documentos pendientes

# Para cada documento del rango: las areas (de las pedidas) para las que todavia no se reviso
_FALTAN = """array(SELECT a FROM unnest(%(areas)s::int[]) a
                   WHERE NOT a = ANY(coalesce((SELECT c.areas FROM area_cobertura c
                                              WHERE c.tipo = '{t}' AND c.ref_id = {x}.id), '{{}}')))"""


def normas_pendientes(desde, hasta, area_ids):
    filas = consultar(f"""
        SELECT n.id, n.fecha, n.tipo, n.numero, n.entidad, n.sumilla, n.hash_unico, n.url_detalle,
               {_FALTAN.format(t='N', x='n')} AS faltan
        FROM normas n WHERE n.fecha BETWEEN %(d)s AND %(h)s
        ORDER BY n.fecha DESC, n.id DESC""", {"d": desde, "h": hasta, "areas": list(area_ids)})
    return [f for f in filas if f[8]]


def proyectos_pendientes(desde, hasta, area_ids):
    """Proyectos presentados en el rango o publicados como ley en el rango."""
    filas = consultar(f"""
        SELECT p.id, coalesce(p.fecha_presentacion, p.ley_fecha), p.numero, p.camara, p.proponente, p.autor,
               CASE WHEN p.ley_numero IS NOT NULL
                    THEN 'Aprobada y publicada: ' || coalesce(p.ley_tipo, 'Ley') || ' N° ' || p.ley_numero ||
                         coalesce(' (El Peruano, ' || p.ley_fecha || ')', '')
                    ELSE p.estado END,
               p.titulo, p.sumilla, p.periodo || '|' || p.camara || '|' || p.numero,
               (SELECT n.hash_unico FROM normas n WHERE n.id = (p.ley_docs->'ley'->>'id')::bigint),
               {_FALTAN.format(t='P', x='p')} AS faltan
        FROM proyectos_ley p
        WHERE p.fecha_presentacion BETWEEN %(d)s AND %(h)s OR p.ley_fecha BETWEEN %(d)s AND %(h)s
        ORDER BY p.fecha_presentacion DESC NULLS LAST, p.id DESC""",
        {"d": desde, "h": hasta, "areas": list(area_ids)})
    return [f for f in filas if f[11]]


# --------------------------------------------------------------------------- IA

def _simple(t):
    t = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", t).split())


def _lista_areas(areas):
    return "\n".join(f"{i}. {nombre}: {desc}" for i, (_, nombre, desc) in enumerate(areas, 1))


CRITERIO_RELEVANCIA = """Un documento afecta a un área si cambia o puede cambiar las reglas, los costos, los derechos, las
obligaciones, los permisos, los mercados o las autoridades de esa área, o si el área debe conocerlo para
tomar decisiones. Ten en cuenta especialmente:
- Leyes, decretos legislativos, decretos de urgencia, decretos supremos, reglamentos, directivas y
  resoluciones de alcance general del área.
- Proyectos de ley y leyes que delegan facultades para legislar en materias del área.
- Designaciones, renuncias, encargos o ceses de autoridades con poder de decisión sobre el área
  (ministros, viceministros, jefes de organismos reguladores, supervisores o fiscalizadores del área).
- Viajes, gastos, contrataciones o actos de autoridades del área que el propio documento muestre como
  inusuales o sin relación evidente con su función.
- Normas de gobiernos regionales y municipales cuando regulan algo del área (por ejemplo, zonificación
  para construcción, tasas que afectan a un sector, autorizaciones de actividades del área).
NO afectan al área: actos rutinarios sin efecto en el área (designación de personal administrativo,
saludos, reconocimientos, viajes ordinarios de funcionarios sin relación con el área) ni normas de otras
materias que solo la mencionan de paso."""


FILTRO_INSTR = """Eres analista legal y regulatorio en el Perú. Recibes una lista de ÁREAS y una lista de DOCUMENTOS
(normas legales publicadas en El Peruano o proyectos de ley del Congreso; cada uno con su id y su
descripción). Para cada documento indica a qué áreas afecta (por su número). Un documento puede afectar a
varias áreas o a ninguna.

""" + CRITERIO_RELEVANCIA + """

Responde solo con el JSON pedido: "resultados" = un elemento por CADA id recibido, con "id" y "areas"
(la lista de números de las áreas afectadas; vacía si no afecta a ninguna)."""

FILTRO_ESQUEMA = {
    "type": "OBJECT",
    "properties": {"resultados": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "id": {"type": "STRING"}, "areas": {"type": "ARRAY", "items": {"type": "INTEGER"}}},
        "required": ["id", "areas"]}}},
    "required": ["resultados"],
}


def filtrar(items, areas):
    """items: [(id, descripcion)]; areas: [(area_id, nombre, descripcion)].
    Devuelve {id: set(area_id)} con un elemento por cada id. SinRespuesta si la IA no responde."""
    numeros = {i: a[0] for i, a in enumerate(areas, 1)}
    salida = {}
    for i in range(0, len(items), LOTE_FILTRO):
        lote = items[i:i + LOTE_FILTRO]
        pendientes = lote
        for _ in range(2):   # si la IA omite algun id, se le vuelven a preguntar solo esos
            contenido = ("ÁREAS:\n" + _lista_areas(areas) + "\n\nDOCUMENTOS:\n" +
                         "\n".join(f"{k} | {d[:700]}" for k, d in pendientes))
            try:
                datos, _ = gemini.generar_json(FILTRO_INSTR, contenido, FILTRO_ESQUEMA, MODELOS, 8192)
            except gemini.ErrorGemini as e:
                raise SinRespuesta(str(e)[:200]) from e
            validos = {k for k, _ in pendientes}
            for r in (datos.get("resultados") or []) if isinstance(datos, dict) else []:
                k = str(r.get("id", "")).strip() if isinstance(r, dict) else ""
                if k in validos:
                    salida[k] = {numeros[n] for n in (r.get("areas") or [])
                                 if isinstance(n, int) and n in numeros}
            pendientes = [(k, d) for k, d in pendientes if k not in salida]
            if not pendientes:
                break
        if pendientes:
            raise SinRespuesta(f"la IA no respondio por {len(pendientes)} documentos")
    return salida


ANALISIS_INSTR = """Eres analista legal y regulatorio senior en el Perú. Analiza el documento (norma legal publicada
o proyecto de ley) para cada una de las ÁREAS indicadas. Escribe en español claro y sencillo, para lectores
no abogados. Usa solo lo que dice el documento; si algo no se puede saber, dilo. Lee el texto completo,
incluidos los anexos.

""" + CRITERIO_RELEVANCIA + """

Responde solo con el JSON pedido:
- "resumen": 2 a 4 oraciones: en qué consiste el documento.
- "cambios": qué cambia respecto de las normas vigentes (cita la norma que modifica, deroga o reglamenta,
  si el documento lo indica); si crea algo nuevo, dilo.
- "por_area": un elemento por CADA área indicada, con:
  - "area": el nombre exacto del área.
  - "relevante": true si de verdad afecta a esa área (según el criterio de arriba); false si no.
  - "calificacion": para esa área: "Favorable" (la beneficia: reduce costos, cargas o trámites, da
    incentivos, seguridad jurídica o abre oportunidades), "Desfavorable" (la perjudica: aumenta costos,
    obligaciones, sanciones o restricciones, o crea inseguridad jurídica o riesgos) o "Para seguimiento"
    (efecto incierto o mixto, o todavía es proyecto, o hay que vigilar cómo se aplica).
  - "puntaje": entero del 1 al 10: cuánto impacta en esa área (1 = mínimo, 10 = cambia las reglas de
    toda el área).
  - "comentario": 2 a 4 oraciones: cómo afecta a esa área en concreto y qué debería vigilarse."""

ANALISIS_ESQUEMA = {
    "type": "OBJECT",
    "properties": {
        "resumen": {"type": "STRING"}, "cambios": {"type": "STRING"},
        "por_area": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "area": {"type": "STRING"}, "relevante": {"type": "BOOLEAN"}, "calificacion": {"type": "STRING"},
            "puntaje": {"type": "INTEGER"}, "comentario": {"type": "STRING"}},
            "required": ["area", "relevante", "calificacion", "puntaje", "comentario"]}},
    },
    "required": ["resumen", "cambios", "por_area"],
}


def impacto_de(puntaje):
    return "Alto" if puntaje >= 8 else ("Moderado" if puntaje >= 5 else "Bajo")


def _entero(v, defecto=5):
    try:
        return max(1, min(10, int(round(float(v)))))
    except (TypeError, ValueError):
        return defecto


def analizar(cabecera, texto, areas):
    """areas: [(area_id, nombre, descripcion)] a las que el filtro dijo que afecta.
    Devuelve (resumen, cambios, {area_id: dict con relevante, calificacion, puntaje, comentario}, modelo)."""
    contenido = ("ÁREAS:\n" + _lista_areas(areas) + "\n\nDOCUMENTO:\n" + cabecera +
                 ("\n\nTEXTO COMPLETO:\n" + texto if texto else "\n\n(Sin texto completo; analiza con la sumilla.)"))
    try:
        datos, modelo = gemini.generar_json(ANALISIS_INSTR, contenido, ANALISIS_ESQUEMA, MODELOS, 8192)
    except gemini.ErrorGemini as e:
        raise SinRespuesta(str(e)[:200]) from e
    if not isinstance(datos, dict):
        datos = datos[0] if isinstance(datos, list) and datos and isinstance(datos[0], dict) else {}
    por_nombre = {_simple(n): (aid, n) for aid, n, _ in areas}
    por_area = {}
    for r in datos.get("por_area") or []:
        if not isinstance(r, dict):
            continue
        a = por_nombre.get(_simple(r.get("area")))
        if not a:   # nombre algo distinto: el area cuyo nombre comparte mas palabras
            palabras = set(_simple(r.get("area")).split())
            mejor = max(por_nombre.items(), key=lambda kv: len(set(kv[0].split()) & palabras), default=None)
            a = mejor[1] if mejor and set(mejor[0].split()) & palabras else None
        if not a or a[0] in por_area:
            continue
        calif = next((c for c in CALIFICACIONES if _simple(c) == _simple(r.get("calificacion"))), "Para seguimiento")
        puntaje = _entero(r.get("puntaje"))
        por_area[a[0]] = {"relevante": r.get("relevante") is not False, "calificacion": calif,
                          "puntaje": puntaje, "impacto": impacto_de(puntaje),
                          "comentario": str(r.get("comentario") or "").strip()}
    faltan = [aid for aid, _, _ in areas if aid not in por_area]
    if faltan and len(faltan) == len(areas):
        raise SinRespuesta("la respuesta de la IA no trae ninguna de las areas")
    return (str(datos.get("resumen") or "").strip(), str(datos.get("cambios") or "").strip(), por_area, modelo,
            faltan)


# --------------------------------------------------------------------------- proceso

def _procesar(tipo, filas, todas, reloj, avance=None):
    """filas: documentos pendientes (la ultima columna es la lista de areas que faltan).
    todas: {area_id: (area_id, nombre, descripcion)}. Devuelve (documentos revisados, completo)."""
    revisados = 0
    for i in range(0, len(filas), 200):
        if not reloj.queda():
            return revisados, False
        grupo = filas[i:i + 200]
        if tipo == "N":
            items = [(str(f[0]), f"{f[2]} {f[3] or ''} — {f[4] or ''}: {f[5] or ''}") for f in grupo]
        else:
            items = [(str(f[0]), f"Proyecto de ley {f[2]} — {f[7] or ''} — {(f[8] or '')[:400]}") for f in grupo]
        # Se filtra por grupos de documentos que esperan las mismas areas (normalmente, todas)
        por_conjunto = {}
        for f, it in zip(grupo, items):
            por_conjunto.setdefault(tuple(sorted(f[-1])), []).append((f, it))
        for conjunto, pares in por_conjunto.items():
            areas = [todas[a] for a in conjunto if a in todas]
            if not areas:
                continue
            try:
                afectadas = filtrar([it for _, it in pares], areas)
            except SinRespuesta as e:
                print(f"  la IA no respondio al filtro ({e}); se continuara en la proxima ejecucion.")
                return revisados, False
            relevantes = [f for f, _ in pares if afectadas.get(str(f[0]))]
            # Las areas a las que no afecta quedan revisadas sin analisis
            cubrir(tipo, [(f[0], f[1], [a for a in conjunto if a not in afectadas.get(str(f[0]), set())])
                          for f, _ in pares])
            if tipo == "N":
                txt = textos("N", [f[6] for f in relevantes])
            else:
                txt = textos("P", [f[9] for f in relevantes])
                txt_ley = textos("N", [f[10] for f in relevantes if f[10]])
            for f in relevantes:
                if not reloj.queda():
                    return revisados, False
                if tipo == "N":
                    texto = txt.get(f[6]) or ""
                    if not texto:
                        try:
                            pdf = pdf_norma(f[7], f[1])
                            texto = texto_pdf(pdf, MAX_TEXTO) if pdf else ""
                        except Exception:  # noqa: BLE001
                            texto = ""
                    cab = (f"NORMA LEGAL publicada en El Peruano el {f[1]}\nTipo y número: {f[2]} {f[3] or ''}\n"
                           f"Entidad: {f[4] or ''}\nSumilla: {f[5] or ''}")
                else:
                    texto_ley = txt_ley.get(f[10]) if f[10] else ""
                    texto = texto_ley or txt.get(f[9]) or ""
                    camara = {"D": "Cámara de Diputados", "S": "Senado", "C": "Congreso (unicameral)"}.get(f[3], f[3])
                    cab = (f"PROYECTO DE LEY {f[2]} ({camara})\nPresentado: {f[1]}\nProponente: {f[4] or ''}\n"
                           f"Autores: {(f[5] or '')[:300]}\nEstado: {f[6] or ''}\nTítulo: {f[7] or ''}\n"
                           f"Sumilla: {f[8] or ''}")
                    if texto_ley:
                        cab += ("\nIMPORTANTE: ya es ley. El texto de abajo es el de la LEY PUBLICADA, que prevalece "
                                "sobre lo que pedía el proyecto original.")
                areas_doc = [todas[a] for a in sorted(afectadas[str(f[0])])]
                try:
                    resumen, cambios, por_area, modelo, faltan = analizar(cab, texto[:MAX_TEXTO], areas_doc)
                    if faltan:   # la IA olvido alguna area: se le pregunta solo por esas
                        r2 = analizar(cab, texto[:MAX_TEXTO], [todas[a] for a in faltan])
                        por_area.update(r2[2])
                except SinRespuesta as e:
                    print(f"  la IA no respondio al analisis ({e}); se continuara en la proxima ejecucion.")
                    return revisados, False
                lectura = "texto completo" if texto else "sumilla"
                guardar_analisis([{"tipo": tipo, "ref_id": f[0], "area_id": aid, "fecha": f[1],
                                   "calificacion": d["calificacion"], "puntaje": d["puntaje"], "impacto": d["impacto"],
                                   "resumen": resumen, "cambios": cambios, "comentario": d["comentario"],
                                   "lectura": lectura, "modelo": modelo}
                                  for aid, d in por_area.items() if d["relevante"]])
                # Si la IA dijo que al final no afecta a un area, queda revisada sin analisis; si olvido
                # alguna area (aun despues de preguntarle de nuevo), esa queda pendiente
                cubrir(tipo, [(f[0], f[1], list(por_area))])
            revisados += len(pares)
            if avance:
                avance(revisados)
    return revisados, True


def procesar_rango(desde, hasta, area_ids, reloj, avance=None):
    """Revisa normas y proyectos del rango para las areas indicadas (solo lo que falta)."""
    todas = {a[0]: a for a in areas_activas(area_ids)}
    if not todas:
        return True
    normas = normas_pendientes(desde, hasta, list(todas))
    proyectos = proyectos_pendientes(desde, hasta, list(todas))
    print(f"{desde} a {hasta}: {len(normas)} normas y {len(proyectos)} proyectos por revisar "
          f"para {len(todas)} area(s)")
    base = [0]

    def av(n):
        if avance:
            avance(base[0] + n)
    hn, ok1 = _procesar("N", normas, todas, reloj, av)
    base[0] = hn
    if not ok1:
        return False
    hp, ok2 = _procesar("P", proyectos, todas, reloj, av)
    print(f"  revisados: {hn} normas y {hp} proyectos en {reloj.minutos():.1f} min")
    return ok2


def rehacer(desde, hasta):
    """Borra el monitoreo por areas de un rango para volver a hacerlo (por ejemplo, con otros modelos)."""
    for tabla in ("area_revision", "area_cobertura"):
        consultar(f"DELETE FROM {tabla} WHERE fecha BETWEEN %s AND %s", (desde, hasta))
    print(f"Monitoreo por areas borrado de {desde} a {hasta}; se vuelve a revisar.")


def ver(desde, hasta):
    """Muestra el resultado del monitoreo por areas en un rango (para revisar la calidad)."""
    filas = consultar("""SELECT a.nombre, r.tipo, coalesce(n.tipo || ' ' || n.numero, 'Proyecto ' || p.numero),
                                coalesce(n.sumilla, p.titulo), r.calificacion, r.puntaje, r.impacto, r.comentario, r.modelo
                         FROM area_revision r JOIN areas a ON a.id = r.area_id
                         LEFT JOIN normas n ON r.tipo = 'N' AND n.id = r.ref_id
                         LEFT JOIN proyectos_ley p ON r.tipo = 'P' AND p.id = r.ref_id
                         WHERE r.fecha BETWEEN %s AND %s ORDER BY a.nombre, r.puntaje DESC""", (desde, hasta))
    (docs, completos) = consultar("""SELECT count(*), count(*) FILTER (WHERE c.areas @> (SELECT array_agg(id) FROM areas WHERE activa))
                                     FROM area_cobertura c WHERE c.fecha BETWEEN %s AND %s""", (desde, hasta))[0]
    print(f"Documentos revisados: {docs} ({completos} para todas las areas). Analisis guardados: {len(filas)}")
    actual = None
    for area, tipo, doc, sumilla, cal, punt, imp, com, modelo in filas:
        if area != actual:
            actual = area
            print(f"\n=== {area} ===")
        print(f"- [{cal} {punt}/10, impacto {imp}, {modelo}] {doc}: {(sumilla or '')[:160]}")
        print(f"    {(com or '')[:400]}")


def hoy_lima():
    from datetime import datetime, timezone
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def fin_de_mes(dia):
    return (dia.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def mes_completo(ini, fin, area_ids):
    """True si todos los documentos del mes estan revisados para todas las areas indicadas."""
    q = """SELECT EXISTS (SELECT 1 FROM {tabla} x
                          LEFT JOIN area_cobertura c ON c.tipo = '{t}' AND c.ref_id = x.id
                          WHERE {cond} AND NOT coalesce(c.areas, '{{}}') @> %(a)s::int[])"""
    p = {"d": ini, "h": fin, "a": list(area_ids)}
    if consultar(q.format(tabla="normas", cond="x.fecha BETWEEN %(d)s AND %(h)s", t="N"), p)[0][0]:
        return False
    return not consultar(q.format(tabla="proyectos_ley", t="P",
                                  cond="(x.fecha_presentacion BETWEEN %(d)s AND %(h)s OR x.ley_fecha BETWEEN %(d)s AND %(h)s)"),
                         p)[0][0]


def procesar_pedidos(reloj):
    """Area y mes pedidos desde la web («Revisar este mes»), en orden de llegada, con su avance."""
    global MODELOS
    MODELOS = MODELOS_PEDIDOS
    pedidos = consultar("""SELECT id, area_id, mes FROM area_pedidos WHERE estado <> 'hecho' ORDER BY creado_en""")
    print(f"Pedidos pendientes: {len(pedidos)}")
    for pid, area_id, mes in pedidos:
        if not reloj.queda():
            return False
        ini = date.fromisoformat(f"{mes}-01")
        fin = min(fin_de_mes(ini), hoy_lima())
        n = len(normas_pendientes(ini, fin, [area_id])) + len(proyectos_pendientes(ini, fin, [area_id]))
        consultar("""UPDATE area_pedidos SET estado = 'en_curso', empezado_en = coalesce(empezado_en, now()),
                            total = coalesce(hechos, 0) + %s WHERE id = %s""", (n, pid))
        hechos_antes = consultar("SELECT hechos FROM area_pedidos WHERE id = %s", (pid,))[0][0]

        def avance(k, pid=pid, h=hechos_antes):
            consultar("UPDATE area_pedidos SET hechos = %s WHERE id = %s", (h + k, pid))
        if procesar_rango(ini, fin, [area_id], reloj, avance):
            consultar("UPDATE area_pedidos SET estado = 'hecho', hechos = total, hecho_en = now() WHERE id = %s", (pid,))
            print(f"Pedido {pid} ({mes}) listo.")
        else:
            return False
    return True


def procesar_historico(reloj):
    """Meses anteriores, del mas reciente al mas antiguo, para todas las areas activas. Cada documento queda
    anotado al revisarse (area_cobertura): la noche siguiente sigue exactamente en el documento donde quedo."""
    global MODELOS
    MODELOS = MODELOS_HISTORIA
    ids = [a[0] for a in areas_activas()]
    mes = (hoy_lima().replace(day=1) - timedelta(days=1)).replace(day=1)   # el mes anterior
    while mes >= INICIO_HISTORIAL and reloj.queda():
        fin = fin_de_mes(mes)
        if not mes_completo(mes, fin, ids):
            if not procesar_rango(mes, fin, ids, reloj):
                return False
            print(f"Mes {mes:%Y-%m} completo para todas las areas.")
        mes = (mes - timedelta(days=1)).replace(day=1)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["diario", "pedidos", "historico", "rango", "ver", "rehacer"])
    ap.add_argument("fechas", nargs="*")
    ap.add_argument("--max-minutos", type=float, default=300)
    a = ap.parse_args()
    if a.modo == "ver":
        ver(date.fromisoformat(a.fechas[0]), date.fromisoformat(a.fechas[1]))
        return
    reloj = Reloj(a.max_minutos)
    gemini.verificar_clave()
    db.conectar().close()   # aplica las etapas pendientes del esquema
    cargar_areas_base()
    if a.modo in ("diario", "pedidos"):
        if not procesar_pedidos(reloj) or a.modo == "pedidos":
            return
    if a.modo == "diario":
        hoy = hoy_lima()
        inicio = hoy.replace(day=1)
        desde = (inicio - timedelta(days=1)).replace(day=1) if hoy.day <= 5 else inicio
        global MODELOS
        MODELOS = MODELOS_MES
        if not procesar_rango(desde, hoy + timedelta(days=1), None, reloj):
            return
        # Lo que quede de tiempo y de cupo de la IA, para el historial
        if cupos.principal_agotada():
            return
        procesar_historico(reloj)
    elif a.modo == "historico":
        procesar_historico(reloj)
    elif a.modo == "rehacer":
        desde, hasta = date.fromisoformat(a.fechas[0]), date.fromisoformat(a.fechas[1])
        rehacer(desde, hasta)
        procesar_rango(desde, hasta, None, reloj)
    elif a.modo == "rango":
        procesar_rango(date.fromisoformat(a.fechas[0]), date.fromisoformat(a.fechas[1]), None, reloj)


if __name__ == "__main__":
    main()
