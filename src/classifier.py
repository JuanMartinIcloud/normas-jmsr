"""Clasificacion por reglas (gratis): sector segun la entidad emisora, rubro segun palabras clave."""
import re
import unicodedata


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).lower().strip()


# (sector, palabras clave que aparecen en el nombre de la entidad)
SECTORES = [
    # Primero los gobiernos locales y regionales: su nombre suele contener palabras de otros sectores
    # ("Metropolitana", "Aguas Verdes", "Salud" de una gerencia, etc.)
    ("Gobiernos Locales", ["municipalida", "municiplidad", "municipaidad", "municpalidad", "municioalidad",
                           "gobierno local"]),   # incluye nombres mal escritos en El Peruano
    ("Gobiernos Regionales", ["gobierno regional"]),
    ("Congreso", ["congreso de la republica"]),
    ("Presidencia y PCM", ["presidencia del consejo de ministros", "presidencia de la republica", "pcm",
                           "despacho presidencial", "decretos legislativos", "decretos de urgencia",
                           "estadistica e informatica", "servicio civil", "planeamiento estrategico",
                           "ciencia, tecnologia", "ciencia tecnologia", "vida sin drogas",
                           # INDECOPI (adscrito a la PCM); su nombre dice "Defensa de la Competencia"
                           "indecopi", "defensa de la competencia", "propiedad intelectual",
                           "direccion nacional de inteligencia"]),
    ("Economia y Finanzas", ["economia y finanzas", "mef", "sunat", "sbs", "superintendencia de banca",
                             "aduanas", "administracion tributaria", "mercado de valores", "compras publicas",
                             "contrataciones del estado", "contrataciones publicas", "actividad empresarial del estado",
                             "normalizacion previsional", "bienes estatales", "promocion de la inversion privada", "ley n° 29625"]),
    ("Salud", ["salud", "minsa", "essalud", "digesa", "digemid", "sunasa", "enfermedades neoplasicas"]),
    ("Educacion", ["educacion", "minedu", "sunedu", "sineace", "instituciones educativas", "calidad educativa",
                   "biblioteca nacional", "instituto peruano del deporte", "becas"]),
    ("Justicia y Derechos Humanos", ["justicia", "minjus", "inpe", "ministerio publico", "poder judicial", "defensoria",
                                     "registros publicos", "procuraduria general", "fuero militar", "magistratura",
                                     "penitenciario", "30916"]),
    ("Interior", ["interior", "mininter", "policia nacional", "migraciones", "control de servicios de seguridad",
                  "bomberos"]),
    ("Defensa", ["defensa", "mindef", "fuerzas armadas", "instituto geografico nacional", "ejercito", "marina de guerra", "fuerza aerea"]),
    ("Relaciones Exteriores", ["relaciones exteriores", "rree", "cooperacion internacional", "convenios internacionales"]),
    ("Energia y Minas", ["energia y minas", "minem", "osinergmin", "ingemmet", "perupetro", "energia y mineria",
                         "geologico minero", "energia nuclear"]),
    ("Transportes y Comunicaciones", ["transportes y comunicaciones", "mtc", "osiptel", "sutran", "ositran",
                                      "telecomunicaciones", "transporte", "portuaria", "radio y television"]),
    ("Vivienda y Construccion", ["vivienda", "construccion y saneamiento", "sunass", "sedapal", "saneamiento",
                                 "formalizacion de la propiedad", "industria de la construccion"]),
    ("Agricultura y Riego", ["agricultura", "midagri", "senasa", "sernanp", "agua", "ana ", "agrario",
                             "sierra y selva exportadora", "sierra exportadora", "recursos forestales"]),
    ("Ambiente", ["ambiente", "ambiental", "minam", "oefa", "senace", "areas naturales protegidas", "glaciares",
                 "geofisico", "meteorologia e hidrologia", "investigaciones de la amazonia"]),
    ("Produccion", ["de la produccion", "produce", "sanipes", "pesquer", "inocuidad en pesca", "acuicultura", "instituto nacional de calidad"]),
    ("Comercio Exterior y Turismo", ["comercio exterior", "mincetur", "promperu", "turismo"]),
    ("Trabajo y Promocion del Empleo", ["trabajo y promocion del empleo", "mtpe", "sunafil", "fiscalizacion laboral"]),
    ("Mujer y Poblaciones Vulnerables", ["mujer y poblaciones vulnerables", "mimp"]),
    ("Desarrollo e Inclusion Social", ["desarrollo e inclusion social", "midis", "pension 65"]),
    ("Cultura", ["ministerio de cultura", "cultura", "archivo general de la nacion"]),
    ("Organismos Autonomos", ["jne", "jurado nacional de elecciones", "onpe", "reniec", "contraloria", "tribunal constitucional", "banco central",
                              "procesos electorales", "estado civil", "jurados electorales"]),
]

# (rubro, palabras clave en sumilla o tipo)
RUBROS = [
    ("Personal y Designaciones", ["designa", "designacion", "encargan", "acepta renuncia", "aceptan renuncia",
                                  "da por concluida", "dan por concluida", "nombra", "cesa", "autorizan viaje",
                                  "autoriza viaje", "ascienden", "asciende", "condecoran", "mision en el exterior",
                                  "limite de edad"]),
    ("Tributario y Aduanero", ["tribut", "impuesto", "arancel", "aduan", "igv", "renta", "sunat", "uit"]),
    ("Presupuesto y Finanzas Publicas", ["presupuesto", "credito suplementario", "transferencia de partidas", "endeudamiento", "tesoro publico",
                                         "transferencia financiera", "transferencias financieras", "subvencion"]),
    ("Banca, Seguros y Mercado de Valores", ["banco", "autorizan a financiera", "autoriza a financiera", "sistema financiero",
                                             "caja municipal", "caja rural", "edpyme", "cooperativa de ahorro", "seguros",
                                             "mercado de valores", "valores mobiliarios", "superintendencia de banca"]),
    ("Contrataciones del Estado", ["contrataciones del estado", "osce", "licitacion", "adquisiciones"]),
    ("Salud", ["salud", "sanitari", "hospital", "medicament", "vacuna", "epidemi"]),
    ("Educacion", ["educacion", "escuela", "universidad", "docente", "colegio", "curricul"]),
    ("Laboral y Seguridad Social", ["laboral", "trabajador", "pension", "remuneracion", "seguridad social", "empleo"]),
    ("Seguridad y Defensa", ["seguridad ciudadana", "policia", "defensa nacional", "estado de emergencia", "orden interno",
                             "ingreso al territorio", "personal militar"]),
    ("Justicia y Penal", ["penal", "judicial", "delito", "carcel", "penitenciar", "codigo procesal", "extradic",
                          "condenado", "medida disciplinaria", "magistrad", "juez", "jueces"]),
    ("Medio Ambiente y Recursos Naturales", ["ambient", "residuos", "forestal", "biodiversidad", "cambio climatico", "agua", "area natural protegida"]),
    ("Energia y Minería", ["energia", "electric", "hidrocarburo", "mineria", "minero", "minera", "gas natural", "petroleo"]),
    ("Transportes e Infraestructura", ["transporte", "carretera", "vial", "puerto", "aeropuerto", "ferrocarril", "infraestructura"]),
    ("Vivienda y Saneamiento", ["vivienda", "saneamiento", "agua potable", "alcantarillado", "urbano",
                                "inscripcion de dominio", "predio"]),
    ("Agricultura y Pesca", ["agrari", "agricol", "pesquer", "pesca", "riego", "ganader", "fitosanitari", "zoosanitari",
                             "extractiva"]),
    ("Comercio, Industria y Turismo", ["comercio", "industria", "turismo", "exporta", "mype", "empresa",
                                       "barrera burocratica", "barreras burocraticas"]),
    ("Telecomunicaciones y Digital", ["telecomunicaciones", "digital", "internet", "datos personales", "firma electronica"]),
    ("Desarrollo Social", ["inclusion social", "programa social", "vulnerable", "pobreza", "mujer", "discapacidad"]),
    ("Cultura y Patrimonio", ["patrimonio cultural", "cultura", "monumento", "declara de interes nacional",
                              "proteccion provisional", "arqueologic", "patrimonio de la nacion"]),
    ("Elecciones y Organizacion del Estado", ["elector", "elecciones", "reglamento de organizacion", "rof", "organizacion y funciones",
                                              "convocan a ciudadan", "candidat", "vacancia", "revocatoria",
                                              "delegan facultades", "delegan diversas facultades"]),
    ("Relaciones Exteriores", ["tratado", "convenio internacional", "embajad", "consul"]),
]


def clasificar_sector(entidad: str) -> str:
    # Palabras completas (o inicio de palabra en las largas): "ana" no coincide con "Metropolitana",
    # ni "cultura" con "Agricultura"
    e = _norm(entidad)
    for sector, patrones in _SECTORES:
        if any(p.search(e) for p in patrones):
            return sector
    return "Otros"


def _patron(clave: str) -> re.Pattern:
    """La clave debe empezar una palabra ("tribut" no coincide con "contributiva"); las claves cortas
    (siglas como "uit", "igv", "rof") deben ser la palabra completa ("uit" no coincide con "circuito")."""
    c = re.escape(clave.strip())
    return re.compile(rf"\b{c}\b" if len(clave.strip()) <= 4 else rf"\b{c}")


_RUBROS = [(r, [_patron(c) for c in claves]) for r, claves in RUBROS]
_SECTORES = [(sec, [_patron(c) for c in claves]) for sec, claves in SECTORES]


def clasificar_rubro(sumilla: str, tipo: str = "") -> str:
    t = _norm(f"{tipo} {sumilla}")
    for rubro, patrones in _RUBROS:
        if any(p.search(t) for p in patrones):
            return rubro
    return "Sin clasificar"


def clasificar(entidad: str, sumilla: str, tipo: str = "") -> dict:
    return {
        "sector": clasificar_sector(entidad),
        "rubro": clasificar_rubro(sumilla, tipo),
    }
