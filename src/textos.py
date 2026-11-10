"""Funciones comunes para leer documentos oficiales: PDF de El Peruano y portal del Congreso.

Las usan src/indexar.py (texto completo), src/monitoreo.py (analisis) y src/seguimiento.py.
"""
import base64
import io
import logging
import re

import requests
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)   # avisos menores de PDFs mal formados

AGENTE = "Mozilla/5.0 (compatible; normas-jmsr/0.2; consulta de documentos publicos)"
API_CONGRESO = "https://api.congreso.gob.pe/spley-portal-service"
CLAVE_PORTAL = b"ProdALg5ZrAsxBMD"   # clave publica que usa el propio portal del Congreso en el navegador
CABECERAS_CONGRESO = {
    "User-Agent": AGENTE,
    "Origin": "https://wb2server.congreso.gob.pe",
    "Referer": "https://wb2server.congreso.gob.pe/",
    "Accept": "application/json, text/plain, */*",
}
EPDOC = "https://epdoc2.elperuano.pe/EpPo/VistaDE.asp"
MAX_TEXTO = 60_000           # caracteres por documento que se leen para el analisis

_s = requests.Session()


def cifrar(texto: str) -> str:
    rel = padding.PKCS7(128).padder()
    datos = rel.update(str(texto).encode()) + rel.finalize()
    enc = Cipher(algorithms.AES(CLAVE_PORTAL), modes.ECB()).encryptor()
    salida = enc.update(datos) + enc.finalize()
    return base64.b64encode(salida).decode().replace("+", "-").replace("/", "_").replace("=", "")


def texto_pdf(datos: bytes, maximo: int = MAX_TEXTO) -> str:
    lector = PdfReader(io.BytesIO(datos))
    partes = []
    total = 0
    for pagina in lector.pages:
        try:
            t = pagina.extract_text() or ""
        except Exception:  # noqa: BLE001  (una pagina dañada no debe frenar el resto)
            t = ""
        partes.append(t)
        total += len(t)
        if total >= maximo:
            break
    texto = "\n".join(partes)
    texto = re.sub(r"-\n(?=[a-záéíóúñ])", "", texto)   # une palabras cortadas al final de linea
    return re.sub(r"[ \t]+", " ", texto)[:maximo]


def codigo_norma(url_detalle: str) -> str | None:
    """Codigo de la norma en El Peruano (ej. "2562861-1") a partir de su enlace. Formatos conocidos:
    .../dispositivo/NL/2562861-1                      (2023 en adelante)
    .../normaslegales/<titulo>-1849787-2/             (2016-2023)
    .../NormasElperuano/2015/02/14/1200944-7.html     (2015 y algunas posteriores)
    .../NormasElperuano/2021/03/17/1935627-1/1935627-1.htm
    epdoc2.../VistaDE.asp o DescargaIN.asp?Referencias=<base64 de codigo+AAAAMMDD>"""
    u = (url_detalle or "").strip()
    m = re.search(r"/dispositivo/[A-Z]+/(\d+-\d+)", u)
    if m:
        return m.group(1)
    m = re.search(r"Referencias=([A-Za-z0-9+/=_-]+)", u)
    if m:
        try:
            dec = base64.b64decode(m.group(1) + "=" * (-len(m.group(1)) % 4)).decode()
            m2 = re.fullmatch(r"(\d+)[-_](\d{1,3}?)(\d{8})", dec)  # "2442245-1"+fecha o "1602563_1"+fecha
            if m2:
                return f"{m2.group(1)}-{m2.group(2)}"
        except Exception:  # noqa: BLE001
            pass
    # El codigo son 6 a 8 cifras, guion y 1 a 3 cifras, al final del enlace. (Antes se tomaba «31838-2197008» de
    # «...-ley-n-31838-2197008-1/»: el numero de la ley pegado al codigo.)
    m = re.search(r"(?<![\d])(\d{6,8}-\d{1,3})(?:\.html?)?/?$", u)
    if m:
        return m.group(1)
    m = re.search(r"(\d{5,}-\d+)(?:-\d+)?(?:\.html?)?/?$", u)
    return m.group(1) if m else None


def pdf_norma(url_detalle: str, fecha) -> bytes | None:
    codigo = codigo_norma(url_detalle)
    if not codigo:
        return None
    ref = base64.b64encode(f"{codigo}{fecha.strftime('%Y%m%d')}".encode()).decode()
    r = _s.get(EPDOC, params={"Referencias": ref}, headers={"User-Agent": AGENTE}, timeout=90)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content if r.content[:4] == b"%PDF" else None


# --------------------------------------------------------------------------- recorte del texto de una norma
# El PDF de cada norma que entrega El Peruano son las paginas del diario donde aparece: traen el final de la
# norma anterior y el inicio de la siguiente. Cada norma termina con su codigo (ej. «2571897-1»), el mismo de
# su enlace: con eso se corta el texto exactamente donde empieza y termina la norma.

_DIAS = r"(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)"
_FECHA = _DIAS + r"\s+\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4}"
_CABECERA = re.compile(
    r"\d{1,4}\s*NORMAS\s+LEGALES\s*" + _FECHA + r"\s*/?\s*El\s+Peruano\s*/?"
    r"|El\s+Peruano\s*/?\s*" + _FECHA + r"\s*/?\s*NORMAS\s+LEGALES\s*\d{1,4}",
    re.I)
_CODIGO = re.compile(r"(?<![\d-])(\d{6,8}-\d{1,2})(?![\d-])")


def _numero_presente(texto: str, numero: str) -> bool:
    """True si el texto contiene el numero de la norma (sus dos primeros grupos de cifras)."""
    grupos = [g.lstrip("0") or "0" for g in re.findall(r"\d+", numero or "")][:2]
    if not grupos:
        return True   # sin numero (ej. algunas «Fe de erratas»): no se puede verificar, no se exige
    return all(re.search(rf"(?<!\d)0*{g}(?!\d)", texto) for g in grupos)


def es_aviso_sin_texto(texto: str) -> bool:
    """El Peruano a veces entrega, en lugar de la norma, un aviso de «el dispositivo se actualizara»."""
    return "Disculpe Ud. la molestia" in (texto or "")[:400] and len(texto or "") < 1000


def recortar_norma(texto: str, codigo: str | None, numero: str = "") -> tuple[str, str]:
    """Devuelve (texto de la norma sola, como se recorto). Si no se puede recortar con seguridad, devuelve el
    texto completo sin cambios: nunca se pierde texto de la norma por un recorte dudoso.
    Resultados: "codigo" (cortado por su codigo de fin), "inicio" (cortado al inicio; el fin no estaba),
    "sin_codigos", "no_verificado" (el tramo no tenia su numero) o "sin_cambio"."""
    if not texto or not codigo:
        return texto, "sin_cambio"
    if es_aviso_sin_texto(texto):
        return "", "aviso"
    limpio = _CABECERA.sub(" ", texto)
    codigos = [(m.group(1), m.start(), m.end()) for m in _CODIGO.finditer(limpio)]
    if not codigos:
        return texto, "sin_codigos"
    propios = [c for c in codigos if c[0] == codigo]
    if propios:
        # Su ultima aparicion: en las «publicaciones digitales» su codigo se repite al pie de cada pagina
        fin = propios[-1][2]
        anteriores = [c for c in codigos if c[2] <= propios[0][1] and c[0] != codigo]
        inicio = anteriores[-1][2] if anteriores else 0
        tramo, modo = limpio[inicio:fin], "codigo"
        if anteriores and not _numero_presente(tramo, numero):
            # Paginas a dos columnas: el inicio de la norma puede quedar antes del codigo de la anterior.
            # Se corta solo el final (lo que viene despues de su codigo).
            tramo, modo = limpio[:fin], "solo_fin"
    else:
        # Su codigo no aparece (el texto se corto antes): empieza despues del ultimo codigo ajeno y no se
        # sabe donde termina, asi que se conserva hasta el final. Solo si el texto son paginas del diario
        # (empieza con su cabecera): un texto de otra fuente (ej. la ley del portal del Congreso) no se toca.
        if not _CABECERA.search(texto[:300]):
            return texto, "sin_cambio"
        tramo, modo = limpio[codigos[-1][2]:], "inicio"
    tramo = re.sub(r"[ \t]+", " ", tramo).strip()
    if len(tramo) < 100 or not _numero_presente(tramo, numero):
        return texto, "no_verificado"
    return tramo, modo
