"""Monitoreo empresarial (reportes para AmCham Peru).

Para cada norma legal y cada proyecto de ley:
1. Filtro con IA (por lotes): ¿afecta al sector empresarial, a las empresas o al clima de inversion?
2. Para los relevantes, analisis con IA leyendo el texto completo: resumen, cambios a las normas
   vigentes, comentario de impacto, sector economico, calificacion (Favorable / Desfavorable /
   Para seguimiento), nivel de impacto, comites de AmCham involucrados y acciones sugeridas para
   cada comite y para el Directorio.
Todo queda en la tabla "analisis"; la web arma los reportes con ella.

    python src/monitoreo.py diario              # mes actual (solo lo que falta) + movimientos del Congreso
    python src/monitoreo.py pedidos             # meses y documentos pedidos desde la web (a pedido)
    python src/monitoreo.py historico           # el mes anterior al ultimo procesado (cada madrugada, hasta 2015)
    python src/monitoreo.py rango 2026-08-01 2026-08-31
Opciones: --max-minutos 300
"""
import argparse
import os
import re
import sys
import time
from datetime import date, timedelta

import psycopg2
from psycopg2.extras import Json, execute_values

import bases
import cupos
import db
import gemini
from textos import pdf_norma, texto_pdf

COMITES = [
    "Dispositivos Médicos", "Educación", "Facilitación de Comercio", "Infraestructura, Energía y Minería",
    "Minería", "Proveedores de Infraestructura Pasiva", "Salud", "Supply Chain Management",
    "Telecomunicaciones", "Turismo", "Asuntos Corporativos", "Asuntos Financieros", "Asuntos Jurídicos",
    "Asuntos Tributarios", "Desarrollo Sostenible", "Comunicación Interna", "Compliance",
    "Diversidad & Inclusión", "Gestión Humana", "Innovación", "Management Support", "Marketing",
]
SECTORES = [
    "Minería", "Hidrocarburos", "Electricidad", "Infraestructura y transporte", "Telecomunicaciones",
    "Financiero y seguros", "Comercio exterior y aduanas", "Agricultura y agroindustria", "Pesca",
    "Industria manufacturera", "Construcción e inmobiliario", "Salud y farmacéutico", "Educación",
    "Turismo", "Comercio y consumo", "Tecnología y economía digital", "Laboral", "Tributario",
    "Ambiental", "Contrataciones del Estado", "Transversal (todos los sectores)",
]
CALIFICACIONES = ["Favorable", "Desfavorable", "Para seguimiento"]
IMPACTOS = ["Alto", "Moderado", "Bajo"]

# Todo el trabajo automatico usa solo modelos Lite: los Flash (mas precisos) quedan para el usuario
MODELOS_FILTRO = gemini.modelos_lite()
MODELOS_ANALISIS = gemini.modelos_lite()
HIST_FILTRO = gemini.modelos_lite()      # meses anteriores: tambien solo Lite
HIST_ANALISIS = gemini.modelos_lite()
MODELOS_SEGUNDA = gemini.modelos_lite()  # segunda revision de las normas con rango de ley descartadas
LOTE_FILTRO = 40
MAX_TEXTO = 25000

# Criterios del reporte (los usan el filtro, el analisis y la recalificacion; su version es CRITERIO)
CRITERIO = 5
NO_RELEVANTES = """NO son relevantes (quedan fuera del reporte) aunque mencionen a empresas o sectores:
- Actos dirigidos a una empresa, persona o entidad concreta, que no cambian las reglas para el resto:
  concesiones, autorizaciones, licencias, permisos, registros u otorgamiento de derechos a un titular;
  modificación, cesión o adenda de un contrato concreto (por ejemplo, el contrato de un lote petrolero);
  calificación o aprobación de una empresa para un régimen o beneficio (por ejemplo, recuperación
  anticipada del IGV); servidumbres, expropiaciones o transferencias de un predio concreto.
- Designaciones, renuncias, encargos, viajes y licencias de funcionarios; nombramientos de docentes o
  jueces; actos sobre personas concretas; saludos y reconocimientos.
- Normas municipales y regionales (ordenanzas, decretos de alcaldía, acuerdos de concejo, ordenanzas y
  acuerdos regionales): NO son relevantes, incluidos planes de desarrollo urbano o acondicionamiento
  territorial, zonificación, vías, anexión de áreas, habilitaciones, arbitrios y tasas, TUPA o TUSNE,
  beneficios o prórrogas tributarias, reglamentos y comisiones internas. Única excepción: que regulen
  con alcance general una actividad económica importante en Lima Metropolitana o en una región entera
  (por ejemplo, un nuevo régimen de licencias de funcionamiento) y con efecto claro en las empresas.
- Guías, manuales, protocolos y documentos técnicos internos del sector público sin obligaciones nuevas
  para las empresas; remuneraciones, escalas, plazas y régimen de los trabajadores del Estado;
  presupuesto, transferencias de partidas y asuntos internos de entidades públicas; declaraciones de
  interés sin efecto económico."""
CRITERIOS_CALIFICACION = """Calificación (para el sector empresarial y el clima de inversiones en el Perú):
- "Favorable": promueve o favorece el clima de inversión, o beneficia a las empresas de un sector o en
  general: reduce impuestos, costos, cargas o trámites; da incentivos; abre mercados o facilita la
  competencia; da seguridad jurídica o predictibilidad.
- "Desfavorable": perjudica a las empresas o al clima de inversión: aumenta impuestos, costos,
  obligaciones, sanciones o restricciones; crea inseguridad jurídica o trabas.
- "Para seguimiento": el efecto es mixto o incierto, depende de su reglamentación, o es un proyecto de ley
  aún no aprobado cuyo efecto no se puede anticipar con claridad.
Puntaje de impacto, del 1 al 10 (qué tanto afecta a las empresas y al clima de inversión, sea para bien
o para mal):
- 9-10: cambio de gran alcance para muchas empresas o un sector clave (reforma tributaria, laboral o de un
  régimen sectorial; nueva ley general).
- 7-8: cambio importante para un sector o para un grupo amplio de empresas.
- 5-6: efecto moderado o acotado a un subsector o a un tipo de operación.
- 3-4: efecto menor (ajustes operativos o procedimentales).
- 1-2: efecto mínimo.
Las normas de alcance general sobre gobierno corporativo, códigos de buen gobierno, compliance y prevención
(anticorrupción, lavado de activos), sostenibilidad empresarial (ESG, reportes de sostenibilidad), mercado de
valores o deberes de directorios y accionistas aplican a muchas empresas a la vez: van de 7 a 9 según su alcance,
aunque su cumplimiento sea voluntario ("cumplir o explicar").
Usa todo el rango; no pongas puntajes altos por costumbre."""


SECTORES_LOCALES = ("Gobiernos Locales", "Gobiernos Regionales")
_TIPOS_LOCALES = ("ORDENANZA", "DECRETO DE ALCALDIA", "ACUERDO DE CONCEJO", "RESOLUCION DE ALCALDIA",
                  "ACUERDO REGIONAL", "RESOLUCION EJECUTIVA REGIONAL", "ACUERDO DE CONSEJO REGIONAL")


def es_local(tipo, entidad, sector):
    """Norma municipal o regional (queda fuera del reporte, sin consultar a la IA)."""
    import unicodedata
    def n(t):
        return unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().upper()
    if sector in SECTORES_LOCALES:
        return True
    if any(n(tipo).startswith(t) for t in _TIPOS_LOCALES):
        return True
    e = n(entidad)
    return any(x in e for x in ("MUNICIPALIDAD", "GOBIERNO REGIONAL", "CONSEJO REGIONAL"))


INDIVIDUAL = """"acto_individual": true si el documento se refiere a una empresa, contrato, lote, concesión, predio,
  proyecto o persona concreta (por ejemplo: modifica o cede el contrato de un lote petrolero, otorga una
  concesión o autorización a una empresa, califica a una empresa para la recuperación anticipada del IGV,
  designa a un funcionario, aprueba una expropiación); false si establece reglas generales."""


def impacto_de(puntaje):
    """Nivel de impacto segun el puntaje: Alto 8-10, Moderado 5-7, Bajo 1-4."""
    return "Alto" if puntaje >= 8 else ("Moderado" if puntaje >= 5 else "Bajo")


FILTRO_INSTR_BASE = """Eres analista de asuntos públicos de la Cámara de Comercio Americana del Perú (AmCham).
Recibes una lista de normas legales o proyectos de ley del Perú (id y descripción). Marca como
relevantes SOLO los que pueden afectar a las empresas privadas, a sectores económicos o al clima de
inversiones en el Perú: tributos, aduanas y comercio exterior, laboral, regulación sectorial (minería,
energía, hidrocarburos, telecomunicaciones, salud y medicamentos, transporte, financiero, agro, pesca,
turismo, educación privada), concesiones, APP e inversión pública relevante para privados,
contrataciones del Estado, competencia y consumidor, ambiental, datos y economía digital, permisos y
trámites, propiedad, arbitraje, compliance y anticorrupción empresarial.
Las leyes que DELEGAN EN EL PODER EJECUTIVO LA FACULTAD DE LEGISLAR son relevantes (el Ejecutivo dictará
decretos legislativos con fuerza de ley), igual que las leyes, decretos legislativos y decretos de urgencia
de alcance general que cambien reglas para las empresas o la economía. No confundir con las resoluciones
que delegan atribuciones en funcionarios de una entidad (esas no son relevantes).
Una fe de erratas sigue a la norma que corrige: es relevante si esa norma lo es.
{NO_RELEVANTES}
Responde solo con el JSON pedido: "relevantes" = lista de los id relevantes."""

FILTRO_INSTR = FILTRO_INSTR_BASE.replace("{NO_RELEVANTES}", NO_RELEVANTES)

FILTRO_ESQUEMA = {"type": "OBJECT", "properties": {"relevantes": {"type": "ARRAY", "items": {"type": "STRING"}}},
                  "required": ["relevantes"]}


def _analisis_instr():
    return f"""Eres analista senior de asuntos públicos y regulatorios de la Cámara de Comercio Americana del
Perú (AmCham Perú). Analiza el documento (norma legal publicada o proyecto de ley) para el informe a
los comités y al Directorio. Escribe en español claro y sencillo, sin adornos, para lectores no abogados.
Usa solo lo que dice el documento; si no se puede saber algo, dilo. Responde solo con el JSON pedido:
- "resumen": 2 a 4 oraciones: en qué consiste.
- "cambios": qué cambia respecto de las normas vigentes (cita la ley o norma que modifica, deroga o
  reglamenta, si el documento lo indica); si crea algo nuevo, dilo.
- "comentario": 2 a 4 oraciones: cómo afecta al sector empresarial y al clima de inversiones en el Perú.
- "sector": el sector económico principal, uno de: {", ".join(SECTORES)}.
- "calificacion": "Favorable", "Desfavorable" o "Para seguimiento", según los criterios de abajo.
- "puntaje": número entero del 1 al 10, según los criterios de abajo.
- {INDIVIDUAL}
- "comites": los comités de AmCham a los que interesa (1 a 3), elegidos de esta lista exacta:
  {", ".join(COMITES)}.
- "acciones": para cada comité elegido, una acción concreta que debería realizar (por ejemplo: emitir
  opinión técnica, solicitar reunión con la comisión o el ministerio, preparar comentarios al
  reglamento, alertar a los asociados, monitorear su debate).
- "accion_directorio": acción recomendada al Directorio de AmCham (o "Ninguna por ahora").

{CRITERIOS_CALIFICACION}"""


ANALISIS_ESQUEMA = {
    "type": "OBJECT",
    "properties": {
        "resumen": {"type": "STRING"}, "cambios": {"type": "STRING"}, "comentario": {"type": "STRING"},
        "sector": {"type": "STRING"}, "calificacion": {"type": "STRING"}, "puntaje": {"type": "INTEGER"},
        "acto_individual": {"type": "BOOLEAN"},
        "comites": {"type": "ARRAY", "items": {"type": "STRING"}},
        "acciones": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "comite": {"type": "STRING"}, "accion": {"type": "STRING"}}, "required": ["comite", "accion"]}},
        "accion_directorio": {"type": "STRING"},
    },
    "required": ["resumen", "cambios", "comentario", "sector", "calificacion", "puntaje", "comites",
                 "acciones", "accion_directorio"],
}


class Reloj:
    def __init__(self, minutos):
        self.fin = time.time() + minutos * 60

    def queda(self, margen=60):
        return time.time() < self.fin - margen


# --------------------------------------------------------------------------- textos completos

def _bases_texto():
    return [url for _, url in bases.bases_texto()]


def textos(tipo, claves):
    """{clave: texto} desde las bases de texto (solo los que tienen texto)."""
    salida = {}
    if not claves:
        return salida
    for url in _bases_texto():
        try:
            c = psycopg2.connect(url, connect_timeout=60)
            cur = c.cursor()
            cur.execute("SELECT clave, left(texto, %s) FROM documentos WHERE tipo = %s AND clave = ANY(%s) AND estado = 'ok'",
                        (MAX_TEXTO, tipo, list(claves)))
            for k, t in cur.fetchall():
                salida[k] = t
            c.close()
        except psycopg2.Error as e:
            print(f"  base de texto no disponible: {str(e)[:100]}")
    return salida


# --------------------------------------------------------------------------- IA

RANGO_LEY = re.compile(r"^\s*(fe\s+de\s+erratas?\s+)?(ley|decreto\s+legislativo|decreto\s+de\s+urgencia|"
                       r"resoluci[oó]n\s+legislativa)\b", re.I)
ERRATA = re.compile(r"^\s*fe\s+de\s+erratas?\s+", re.I)


def normas_corregidas(filas):
    """{id de cada fe de erratas: (descripcion de la norma que corrige, si esa norma es relevante)}."""
    erratas = [f for f in filas if ERRATA.match(f[2] or "") and f[3]]
    if not erratas:
        return {}
    base = consultar(
        """SELECT DISTINCT ON (lower(n.tipo), n.numero) lower(n.tipo), n.numero, n.tipo, n.entidad, n.sumilla,
                  coalesce(a.relevante AND NOT a.excluido, FALSE)
           FROM normas n LEFT JOIN analisis a ON a.tipo = 'N' AND a.ref_id = n.id
           WHERE n.numero = ANY(%s) AND lower(n.tipo) = ANY(%s)
           ORDER BY lower(n.tipo), n.numero, n.fecha DESC""",
        (list({f[3] for f in erratas}), list({ERRATA.sub("", f[2]).strip().lower() for f in erratas})))
    m = {(t, num): (f"{tipo} {num} — {ent or ''}: {sum_ or ''}", rel) for t, num, tipo, ent, sum_, rel in base}
    salida = {}
    for f in erratas:
        b = m.get((ERRATA.sub("", f[2]).strip().lower(), f[3]))
        if b:
            salida[f[0]] = b
    return salida


def filtrar(items, modelos=None):
    """items: [(id, descripcion)] -> set de ids relevantes. None si la IA no responde."""
    modelos = modelos or MODELOS_FILTRO
    relevantes = set()
    for i in range(0, len(items), LOTE_FILTRO):
        lote = items[i:i + LOTE_FILTRO]
        contenido = "\n".join(f"{k} | {d[:700]}" for k, d in lote)
        try:
            datos, _ = gemini.generar_json(FILTRO_INSTR, contenido, FILTRO_ESQUEMA, modelos, 4096)
        except gemini.ErrorGemini as e:
            print(f"  filtro sin respuesta: {str(e)[:200]}")
            return None if not relevantes and i == 0 else (relevantes, i)
        validos = {k for k, _ in lote}
        relevantes |= {str(x).strip() for x in datos.get("relevantes", []) if str(x).strip() in validos}
    return relevantes, len(items)


def entero_1_10(v, defecto=5):
    try:
        return max(1, min(10, int(round(float(v)))))
    except (TypeError, ValueError):
        return defecto


def _simple(t):
    import unicodedata
    t = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().lower()
    palabras = re.sub(r"[^a-z0-9 ]+", " ", re.sub(r"^\W*comite( de)?\s+", "", t)).split()
    return [w for w in palabras if w not in ("e", "y", "de", "del", "la", "el")]


def comite_de(texto):
    """Comite de AmCham a partir de lo que escribio la IA. Acepta diferencias de tildes, mayusculas,
    la palabra «Comité» delante o el nombre incompleto (antes estas diferencias dejaban documentos sin comites)."""
    buscado = _simple(texto)
    if not buscado:
        return None
    for o in COMITES:
        if _simple(o) == buscado:
            return o
    for o in COMITES:   # nombre incompleto o con palabras de mas: el que mas palabras comparte
        comun = len(set(_simple(o)) & set(buscado))
        if comun and comun >= min(len(_simple(o)), len(buscado)):
            return o
    return None


def _limpia(datos):
    def uno(v, opciones, defecto):
        v = str(v or "").strip()
        for o in opciones:
            if v.lower() == o.lower():
                return o
        return defecto
    if not isinstance(datos, dict):
        datos = datos[0] if isinstance(datos, list) and datos and isinstance(datos[0], dict) else {}
    comites = []
    for c in datos.get("comites") or []:
        o = comite_de(c)
        if o and o not in comites:
            comites.append(o)
    acciones = []
    for a in datos.get("acciones") or []:
        if not isinstance(a, dict):
            continue
        com = comite_de(a.get("comite", ""))
        if com and a.get("accion"):
            acciones.append({"comite": com, "accion": str(a["accion"]).strip()})
            if com not in comites:
                comites.append(com)
    puntaje = entero_1_10(datos.get("puntaje"), {"Alto": 8, "Moderado": 6, "Bajo": 3}.get(
        uno(datos.get("impacto"), IMPACTOS, "Moderado")))
    return {
        "resumen": str(datos.get("resumen") or "").strip(),
        "cambios": str(datos.get("cambios") or "").strip(),
        "comentario": str(datos.get("comentario") or "").strip(),
        "sector": uno(datos.get("sector"), SECTORES, "Transversal (todos los sectores)"),
        "calificacion": uno(datos.get("calificacion"), CALIFICACIONES, "Para seguimiento"),
        "puntaje": puntaje,
        "impacto": impacto_de(puntaje),
        "criterio": CRITERIO,
        "acto_individual": datos.get("acto_individual") is True,
        "comites": comites,
        "acciones": acciones,
        "accion_directorio": str(datos.get("accion_directorio") or "").strip(),
    }


def analizar(cabecera, texto):
    contenido = cabecera + ("\n\nTEXTO COMPLETO:\n" + texto if texto else "\n\n(Sin texto completo; analiza con la sumilla.)")
    datos, modelo = gemini.generar_json(_analisis_instr(), contenido, ANALISIS_ESQUEMA, MODELOS_ANALISIS, 4096)
    return _limpia(datos), modelo


# --------------------------------------------------------------------------- base de datos

def guardar(filas):
    """filas: dicts con tipo, ref_id, fecha, relevante y (si relevante) los campos del analisis."""
    if not filas:
        return
    cols = ["tipo", "ref_id", "fecha", "relevante", "resumen", "cambios", "comentario", "sector",
            "calificacion", "impacto", "puntaje", "criterio", "comites", "acciones", "accion_directorio",
            "lectura", "modelo"]
    valores = []
    forzados = []
    for f in filas:
        forzado = f.pop("forzado", False)
        manual = f.pop("manual", forzado)
        if f.pop("acto_individual", False) and not forzado:
            f["relevante"] = False   # acto sobre una empresa, contrato o persona concreta: fuera del reporte
        if manual:
            forzados.append((f["tipo"], f["ref_id"]))
        v = [f.get(c) for c in cols]
        v[cols.index("acciones")] = Json(f["acciones"]) if f.get("acciones") is not None else None
        valores.append(v)
    c = db.conectar()
    with c.cursor() as cur:
        execute_values(cur, f"""INSERT INTO analisis ({', '.join(cols)}) VALUES %s
            ON CONFLICT (tipo, ref_id) DO UPDATE SET
              -- lo pasado a mano a "impacto empresarial" sigue en el reporte aunque la IA lo vuelva a revisar
              relevante = analisis.manual OR EXCLUDED.relevante, resumen = EXCLUDED.resumen,
              cambios = EXCLUDED.cambios, comentario = EXCLUDED.comentario, sector = EXCLUDED.sector,
              calificacion = EXCLUDED.calificacion, impacto = EXCLUDED.impacto, puntaje = EXCLUDED.puntaje,
              criterio = EXCLUDED.criterio, comites = EXCLUDED.comites,
              acciones = EXCLUDED.acciones, accion_directorio = EXCLUDED.accion_directorio,
              lectura = EXCLUDED.lectura, modelo = EXCLUDED.modelo, creado_en = now()""", valores)
        # Pasados a mano a "impacto empresarial": quedan en el reporte aunque antes se hubieran quitado
        for t, r in forzados:
            cur.execute("""UPDATE analisis SET relevante = TRUE, manual = TRUE, excluido = FALSE, excluido_por = NULL,
                                  excluido_en = NULL WHERE tipo = %s AND ref_id = %s""", (t, r))
    c.commit()
    c.close()


def consultar(sql, params=()):
    c = db.conectar()
    with c.cursor() as cur:
        cur.execute(sql, params)
        filas = cur.fetchall()
    c.commit()
    c.close()
    return filas


# --------------------------------------------------------------------------- proceso

def procesar_normas(desde, hasta, reloj, ids=None, forzar=False, manual=None):
    """ids: solo esas normas (pedidos desde la web); None = todas las del rango sin analisis.
    forzar: pasadas a mano a "impacto empresarial": se analizan completas sin pasar por el filtro."""
    columnas = "n.id, n.fecha, n.tipo, n.numero, n.entidad, n.sumilla, n.hash_unico, n.url_detalle, n.sector"
    sin_analisis = "NOT EXISTS (SELECT 1 FROM analisis a WHERE a.tipo = 'N' AND a.ref_id = n.id)"
    if ids is not None:
        filas = consultar(f"""SELECT {columnas} FROM normas n WHERE n.id = ANY(%s)
                              {'' if forzar else 'AND ' + sin_analisis} ORDER BY n.fecha DESC, n.id DESC""",
                          ([int(x) for x in ids],))
    else:
        filas = consultar(f"""SELECT {columnas} FROM normas n WHERE n.fecha BETWEEN %s AND %s AND {sin_analisis}
                              ORDER BY n.fecha DESC, n.id DESC""", (desde, hasta))
    print(f"Normas por revisar {desde} a {hasta}: {len(filas)}")
    hechas = 0
    for i in range(0, len(filas), 200):
        if not reloj.queda():
            break
        grupo = filas[i:i + 200]
        # Normas municipales y regionales: fuera del reporte, sin consultar a la IA (salvo las pasadas a mano)
        locales = [] if forzar else [f for f in grupo if es_local(f[2], f[4], f[8])]
        guardar([{"tipo": "N", "ref_id": f[0], "fecha": f[1], "relevante": False, "criterio": CRITERIO} for f in locales])
        grupo = [f for f in grupo if not es_local(f[2], f[4], f[8])]
        if not grupo:
            continue
        n_grupo = len(grupo)
        corregidas = normas_corregidas(grupo)

        def descripcion(f):
            if f[0] in corregidas:
                return f"{f[2]} {f[3] or ''} — Fe de erratas de: {corregidas[f[0]][0]}"
            return f"{f[2]} {f[3] or ''} — {f[4] or ''}: {f[5] or ''}"
        items = [(str(f[0]), descripcion(f)) for f in grupo]
        r = (set(k for k, _ in items), len(items)) if forzar else filtrar(items)
        if r is None:
            print("La IA no respondio al filtro; se continuara en la proxima ejecucion.")
            return hechas, False
        relevantes, cubiertos = r
        grupo = grupo[:cubiertos]
        # La fe de erratas de una norma relevante tambien lo es
        relevantes |= {str(f[0]) for f in grupo if corregidas.get(f[0], ("", False))[1]}
        # Segunda opinion, con un modelo mas preciso, para las normas con rango de ley que el filtro
        # rapido descarto (leyes, decretos legislativos y de urgencia, resoluciones legislativas)
        dudosas = [(str(f[0]), descripcion(f)) for f in grupo if str(f[0]) not in relevantes and RANGO_LEY.match(f[2] or "")]
        if dudosas:
            r2 = filtrar(dudosas, MODELOS_SEGUNDA)
            if r2 is None or r2[1] < len(dudosas):
                print("La IA no respondio a la segunda revision de normas con rango de ley; se continuara en la proxima ejecucion.")
                return hechas, False
            if r2[0]:
                print(f"  segunda revision: {len(r2[0])} de {len(dudosas)} normas con rango de ley pasan al analisis")
            relevantes |= r2[0]
        no_rel = [{"tipo": "N", "ref_id": f[0], "fecha": f[1], "relevante": False, "criterio": CRITERIO} for f in grupo if str(f[0]) not in relevantes]
        guardar(no_rel)
        rel = [f for f in grupo if str(f[0]) in relevantes]
        txt = textos("N", [f[6] for f in rel])
        lote = []
        for f in rel:
            if not reloj.queda():
                break
            texto = txt.get(f[6])
            if not texto:
                try:
                    pdf = pdf_norma(f[7], f[1])
                    texto = texto_pdf(pdf, MAX_TEXTO) if pdf else ""
                except Exception:  # noqa: BLE001
                    texto = ""
            cab = (f"NORMA LEGAL publicada en El Peruano el {f[1]}\nTipo y número: {f[2]} {f[3] or ''}\n"
                   f"Entidad: {f[4] or ''}\nSumilla: {f[5] or ''}")
            if f[0] in corregidas:
                cab += f"\nEs la fe de erratas de: {corregidas[f[0]][0]}"
            try:
                datos, modelo = analizar(cab, texto[:MAX_TEXTO] if texto else "")
            except gemini.ErrorGemini as e:
                print(f"  analisis sin respuesta: {str(e)[:200]}")
                guardar(lote)
                return hechas, False
            lote.append({"tipo": "N", "ref_id": f[0], "fecha": f[1], "relevante": True, **datos,
                         "lectura": "texto completo" if texto else "sumilla", "modelo": modelo, "forzado": forzar,
                         "manual": forzar if manual is None else manual})
            hechas += 1
            if len(lote) >= 10:
                guardar(lote)
                lote = []
        guardar(lote)
        print(f"  {i + len(grupo)} normas revisadas, {hechas} analizadas")
        if cubiertos < n_grupo:
            return hechas, False
    return hechas, True


# Movimientos del Congreso que justifican analizar (o volver a analizar) un proyecto
MOVIMIENTOS = r"dictamen|aut.grafa|senado|aprobad|publicad"


# Proyectos del periodo por analizar: sin analisis (presentados, publicados como ley o con un movimiento
# importante en el periodo), o ya analizados pero que avanzaron despues
CONDICION_PROYECTOS = """(a.id IS NULL AND (p.fecha_presentacion BETWEEN %(d)s AND %(h)s OR p.ley_fecha BETWEEN %(d)s AND %(h)s
                                    OR EXISTS (SELECT 1 FROM seguimientos s WHERE s.proyecto_id = p.id
                                                 AND (s.fecha AT TIME ZONE 'America/Lima')::date BETWEEN %(d)s AND %(h)s
                                                 AND s.estado ~* %(mov)s)))
              -- Ya analizado pero avanzo despues (dictamen, aprobacion, autografa, publicacion como ley):
              -- se vuelve a analizar para que el analisis refleje su estado actual
              OR (a.id IS NOT NULL AND NOT a.excluido
                  AND (EXISTS (SELECT 1 FROM seguimientos s WHERE s.proyecto_id = p.id AND s.fecha > a.creado_en
                                 AND (s.fecha AT TIME ZONE 'America/Lima')::date BETWEEN %(d)s AND %(h)s
                                 AND s.estado ~* %(mov)s)
                       OR (p.ley_fecha BETWEEN %(d)s AND %(h)s AND a.creado_en < p.ley_fecha + 1)))"""


def procesar_proyectos(desde, hasta, reloj, ids=None, forzar=False, manual=None):
    """ids / forzar: como en procesar_normas (pedidos desde la web)."""
    if ids is not None:
        condicion = "p.id = ANY(%(ids)s)" + ("" if forzar else " AND a.id IS NULL")
    else:
        condicion = CONDICION_PROYECTOS
    filas = consultar(
        f"""SELECT p.id, p.fecha_presentacion, p.numero, p.camara, p.proponente, p.autor,
                  CASE WHEN p.ley_numero IS NOT NULL
                       THEN 'Aprobada y publicada: ' || coalesce(p.ley_tipo, 'Ley') || ' N° ' || p.ley_numero ||
                            coalesce(' (El Peruano, ' || p.ley_fecha || ')', '')
                       ELSE p.estado END,
                  p.titulo, p.sumilla, p.periodo || '|' || p.camara || '|' || p.numero,
                  (SELECT n.hash_unico FROM normas n WHERE n.id = (p.ley_docs->'ley'->>'id')::bigint)
           FROM proyectos_ley p
           LEFT JOIN analisis a ON a.tipo = 'P' AND a.ref_id = p.id
           WHERE {condicion}
           ORDER BY p.fecha_presentacion DESC NULLS LAST""", {"d": desde, "h": hasta, "mov": MOVIMIENTOS, "ids": [int(x) for x in (ids or [])]})
    print(f"Proyectos por revisar {desde} a {hasta}: {len(filas)}")
    hechas = 0
    for i in range(0, len(filas), 200):
        if not reloj.queda():
            break
        grupo = filas[i:i + 200]
        items = [(str(f[0]), f"{f[7] or ''} — {(f[8] or '')[:400]}") for f in grupo]
        r = (set(k for k, _ in items), len(items)) if forzar else filtrar(items)
        if r is None:
            return hechas, False
        relevantes, cubiertos = r
        grupo = grupo[:cubiertos]
        fecha = lambda f: f[1] or desde  # noqa: E731
        guardar([{"tipo": "P", "ref_id": f[0], "fecha": fecha(f), "relevante": False, "criterio": CRITERIO}
                 for f in grupo if str(f[0]) not in relevantes])
        rel = [f for f in grupo if str(f[0]) in relevantes]
        txt = textos("P", [f[9] for f in rel])
        # Ya es ley: se analiza el texto de la ley publicada (el Congreso puede haberlo cambiado respecto del proyecto)
        txt_ley = textos("N", [f[10] for f in rel if f[10]])
        lote = []
        for f in rel:
            if not reloj.queda():
                break
            texto_ley = txt_ley.get(f[10]) if f[10] else ""
            texto = texto_ley or txt.get(f[9]) or ""
            camara = {"D": "Cámara de Diputados", "S": "Senado", "C": "Congreso (unicameral)"}.get(f[3], f[3])
            cab = (f"PROYECTO DE LEY / PROPOSICIÓN LEGISLATIVA {f[2]} ({camara})\nPresentado: {f[1]}\n"
                   f"Proponente: {f[4] or ''}\nAutores: {(f[5] or '')[:300]}\nEstado: {f[6] or ''}\n"
                   f"Título: {f[7] or ''}\nSumilla: {f[8] or ''}")
            if texto_ley:
                cab += ("\nIMPORTANTE: ya es ley. El texto de abajo es el de la LEY PUBLICADA, que prevalece sobre lo "
                        "que pedía el proyecto original; describe lo que dispone la ley.")
            try:
                datos, modelo = analizar(cab, texto[:MAX_TEXTO])
            except gemini.ErrorGemini as e:
                print(f"  analisis sin respuesta: {str(e)[:200]}")
                guardar(lote)
                return hechas, False
            lote.append({"tipo": "P", "ref_id": f[0], "fecha": fecha(f), "relevante": True, **datos,
                         "lectura": "texto completo" if texto else "sumilla", "modelo": modelo, "forzado": forzar,
                         "manual": forzar if manual is None else manual})
            hechas += 1
            if len(lote) >= 10:
                guardar(lote)
                lote = []
        guardar(lote)
        print(f"  {i + len(grupo)} proyectos revisados, {hechas} analizados")
        if cubiertos < len(filas[i:i + 200]):
            return hechas, False
    return hechas, True


def leer_config(clave):
    f = consultar("SELECT valor FROM configuracion WHERE clave = %s", (clave,))
    return f[0][0] if f else None


def escribir_config(clave, valor):
    c = db.conectar()
    with c.cursor() as cur:
        cur.execute("""INSERT INTO configuracion (clave, valor) VALUES (%s, %s)
                       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = now()""", (clave, valor))
    c.commit()
    c.close()


def hoy_lima():
    from datetime import datetime, timezone
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def fin_de_mes(dia):
    sig = (dia.replace(day=28) + timedelta(days=4)).replace(day=1)
    return sig - timedelta(days=1)


def procesar_pedidos(reloj):
    """Meses y documentos pedidos desde la web: un mes que alguien abrio en el monitoreo, los resultados
    de una busqueda guardada aun sin revisar, o documentos pasados a mano a "impacto empresarial"."""
    pedidos = consultar("""SELECT id, tipo, ref, forzar FROM analisis_pedidos WHERE estado = 'pendiente'
                           ORDER BY forzar DESC, creado_en""")
    print(f"Pedidos pendientes: {len(pedidos)}")
    hechos = []
    inicio, final = date(2000, 1, 1), date(2100, 1, 1)
    for tipo in ("N", "P"):
        for forzar in (True, False):
            grupo = [p for p in pedidos if p[1] == tipo and bool(p[3]) == forzar and str(p[2]).isdigit()]
            if not grupo or not reloj.queda():
                continue
            funcion = procesar_normas if tipo == "N" else procesar_proyectos
            _, completo = funcion(inicio, final, reloj, ids=[p[2] for p in grupo], forzar=forzar)
            if completo:
                hechos += [p[0] for p in grupo]
    for pid, tipo, ref, _ in pedidos:
        if tipo != "M" or not reloj.queda():
            continue
        try:
            ini = date.fromisoformat(f"{ref}-01")
        except ValueError:
            hechos.append(pid)
            continue
        if rango(ini, fin_de_mes(ini), reloj):
            hechos.append(pid)
    if hechos:
        c = db.conectar()
        with c.cursor() as cur:
            cur.execute("UPDATE analisis_pedidos SET estado = 'hecho', hecho_en = now() WHERE id = ANY(%s)", (hechos,))
        c.commit()
        c.close()
    print(f"Pedidos atendidos: {len(hechos)} de {len(pedidos)}")


def rango(desde, hasta, reloj, solo_normas=False):
    hn, ok1 = procesar_normas(desde, hasta, reloj)
    hp, ok2 = (0, True) if solo_normas else procesar_proyectos(desde, hasta, reloj)
    print(f"Rango {desde} a {hasta}: {hn} normas y {hp} proyectos analizados; completo={ok1 and ok2}")
    return ok1 and ok2


INCOMPLETO = """relevante AND NOT excluido AND (coalesce(resumen, '') = '' OR coalesce(cardinality(comites), 0) = 0
                OR calificacion IS NULL OR puntaje IS NULL)"""


def reparar_incompletos(reloj):
    """Documentos del reporte con el analisis incompleto (sin resumen, comites, calificacion o puntaje): se
    vuelven a analizar completos. Es la misma condicion que revisa el control de calidad."""
    filas = consultar(f"SELECT tipo, ref_id, fecha FROM analisis WHERE {INCOMPLETO}")
    if not filas:
        return
    print(f"Documentos del reporte con el analisis incompleto: {len(filas)} -> {filas[:20]}")
    inicio, final = date(2000, 1, 1), date(2100, 1, 1)
    for tipo, funcion in (("N", procesar_normas), ("P", procesar_proyectos)):
        ids = [r for t, r, _ in filas if t == tipo]
        if ids:
            funcion(inicio, final, reloj, ids=ids, forzar=True, manual=False)
    quedan = consultar(f"SELECT tipo, ref_id FROM analisis WHERE {INCOMPLETO}")
    print(f"Quedan incompletos: {len(quedan)} {quedan[:20]}")


# El 9 de noviembre de 2026 se corrigio el texto completo guardado (traia pedazos de otras normas). Las normas
# del reporte analizadas antes con ese texto se vuelven a analizar, de la mas reciente a la mas antigua.
TEXTO_CORREGIDO = "2026-11-09 19:00:00+00"
PENDIENTE_REANALISIS = f"""tipo = 'N' AND relevante AND NOT excluido AND creado_en < '{TEXTO_CORREGIDO}'"""


def reanalizar_texto_corregido(reloj, maximo):
    filas = consultar(f"SELECT ref_id FROM analisis WHERE {PENDIENTE_REANALISIS} ORDER BY fecha DESC, ref_id DESC LIMIT %s",
                      (maximo,))
    if not filas:
        return
    total = consultar(f"SELECT count(*) FROM analisis WHERE {PENDIENTE_REANALISIS}")[0][0]
    print(f"Normas del reporte por volver a analizar con el texto corregido: {total}; en esta ejecucion: {len(filas)}")
    procesar_normas(date(2000, 1, 1), date(2100, 1, 1), reloj, ids=[r[0] for r in filas], forzar=True, manual=False)
    quedan = consultar(f"SELECT count(*) FROM analisis WHERE {PENDIENTE_REANALISIS}")[0][0]
    print(f"Quedan por volver a analizar: {quedan}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["diario", "pedidos", "historico", "rango", "sincomites", "reanalizar"])
    ap.add_argument("--maximo", type=int, default=400)
    ap.add_argument("fechas", nargs="*")
    ap.add_argument("--max-minutos", type=float, default=300)
    ap.add_argument("--forzar", action="store_true")
    a = ap.parse_args()
    reloj = Reloj(a.max_minutos)
    gemini.verificar_clave()
    db.conectar().close()   # aplica las etapas pendientes del esquema
    hoy = hoy_lima()
    if a.modo == "diario":
        inicio_mes = hoy.replace(day=1)
        # Los primeros dias del mes tambien revisa el mes anterior: completa lo que haya quedado pendiente
        # (por ejemplo, si las tareas se detuvieron a fin de mes por el cupo de transferencia). Solo
        # analiza lo que falta, asi que si no falta nada no gasta.
        desde = (inicio_mes - timedelta(days=1)).replace(day=1) if hoy.day <= 5 else inicio_mes
        rango(desde, hoy + timedelta(days=1), reloj)
        reparar_incompletos(reloj)
        reanalizar_texto_corregido(reloj, 300)
        if leer_config("historico_hasta") is None:
            escribir_config("historico_hasta", inicio_mes.isoformat())
    elif a.modo == "pedidos":
        procesar_pedidos(reloj)
    elif a.modo == "sincomites":
        reparar_incompletos(reloj)
    elif a.modo == "reanalizar":
        reanalizar_texto_corregido(reloj, a.maximo)
    elif a.modo == "historico":
        if cupos.principal_agotada():
            return
        global MODELOS_FILTRO, MODELOS_ANALISIS
        MODELOS_FILTRO, MODELOS_ANALISIS = HIST_FILTRO, HIST_ANALISIS
        # Un mes por dia (salvo que se pida --forzar)
        if leer_config("historico_dia") == hoy.isoformat() and not a.forzar:
            print("Hoy ya se agrego un mes al historico.")
            return
        hasta_txt = leer_config("historico_hasta") or hoy.replace(day=1).isoformat()
        limite = date.fromisoformat(hasta_txt)          # primer dia del ultimo mes completo
        if limite <= date(2015, 1, 1):
            print("Historico completo desde 2015.")
            return
        fin = limite - timedelta(days=1)
        ini = fin.replace(day=1)
        if rango(ini, fin, reloj):
            escribir_config("historico_hasta", ini.isoformat())
            escribir_config("historico_dia", hoy.isoformat())
            print(f"Mes {ini:%Y-%m} completo.")
    else:
        rango(date.fromisoformat(a.fechas[0]), date.fromisoformat(a.fechas[1]), reloj)


if __name__ == "__main__":
    main()
