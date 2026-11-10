"""Cliente de El Peruano: descarga y normaliza las normas legales de un dia."""
import hashlib
import re
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

import config
from classifier import clasificar

_sesion = requests.Session()
_sesion.headers.update({
    "User-Agent": config.USER_AGENT,
    "X-Requested-With": "XMLHttpRequest",
})


def _pedir(desde: date, hasta: date) -> str:
    datos = {
        "cddesde": desde.strftime(config.FORMATO_FECHA),
        "cdhasta": hasta.strftime(config.FORMATO_FECHA),
    }
    ultimo_error = None
    for intento in range(1, config.REINTENTOS + 1):
        try:
            r = _sesion.post(config.ENDPOINT, data=datos, timeout=config.TIMEOUT)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            ultimo_error = e
            time.sleep(min(60, config.PAUSA_SEGUNDOS * (2 ** intento)))
    raise RuntimeError(f"Fallo tras {config.REINTENTOS} intentos: {ultimo_error}")


# Abreviatura de "numero" en los titulos: N°, Nº, N.°, No., Nro. (y "No" solo si le sigue una cifra).
# Debe ir precedida de un espacio: asi no se confunde con el "NO" final de palabras como GOBIERNO.
_NUMERO = re.compile(r"^(.*?)\s+(?:N\.?\s?[°º]|N[°º]\.?|No\.|No\s+(?=\d)|Nro\.?)\s*(\S.*)$", re.I)


def _separar_titulo(titulo: str) -> tuple[str, str]:
    """'RESOLUCION N° 505-2026-CG' -> ('Resolucion', '505-2026-CG').
    Sin numero (avisos, codigos): todo el titulo es el tipo, en tipo oracion si es largo."""
    titulo = re.sub(r"\s+", " ", titulo).strip()
    m = _NUMERO.match(titulo)
    if m:
        return m.group(1).strip().title(), m.group(2).strip()
    return (titulo.capitalize() if len(titulo.split()) > 4 else titulo.title()), ""


def _separar_titulo_antiguo(titulo: str) -> tuple[str, str]:
    """Forma anterior de separar el titulo. Solo para calcular hash_unico igual que siempre (no cambia la
    clave de las normas ya guardadas ni la de sus textos)."""
    titulo = re.sub(r"\s+", " ", titulo).strip()
    m = re.match(r"^(.*?)\s*N[°ºo]\.?\s*(.+)$", titulo, flags=re.I)
    if m:
        return m.group(1).strip().title(), m.group(2).strip()
    return titulo.title(), ""


def parsear(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    filas = []
    for art in soup.find_all("article"):
        h4 = art.find("h4")
        h5 = art.find("h5")
        if not h5:
            continue
        enlace = h5.find("a")
        titulo = h5.get_text(" ", strip=True)
        tipo, numero = _separar_titulo(titulo)
        tipo_h, numero_h = _separar_titulo_antiguo(titulo)
        url_detalle = enlace["href"] if enlace and enlace.has_attr("href") else None
        texto = art.find("div", class_="ediciones_texto")
        parrafos = texto.find_all("p") if texto else []
        sumilla = parrafos[-1].get_text(" ", strip=True) if parrafos else ""
        filas.append({
            "tipo": tipo,
            "numero": numero,
            "entidad": h4.get_text(" ", strip=True) if h4 else None,
            "sumilla": sumilla,
            "url_detalle": url_detalle,
            "url_pdf": f"{url_detalle}/pdf" if url_detalle else None,
            "extraordinaria": art.find("strong", class_="extraordinaria") is not None,
            "tipo_hash": tipo_h, "numero_hash": numero_h,
        })
    return filas


def _hash(fecha: date, f: dict) -> str:
    base = "|".join([
        fecha.isoformat(), str(f.get("tipo_hash", f.get("tipo"))), str(f.get("numero_hash", f.get("numero"))),
        str(f.get("entidad")), str(f.get("url_detalle")),
    ])
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def descargar_dia(fecha: date) -> list[dict]:
    """Devuelve las normas de un dia, ya clasificadas y listas para insertar."""
    html = _pedir(fecha, fecha)
    time.sleep(config.PAUSA_SEGUNDOS)
    resultado = []
    for f in parsear(html):
        c = clasificar(f.get("entidad") or "", f.get("sumilla") or "", f.get("tipo") or "")
        resultado.append({
            "fecha": fecha,
            "tipo": f["tipo"],
            "numero": f["numero"],
            "entidad": f["entidad"],
            "sector": c["sector"],
            "rubro": c["rubro"],
            "sumilla": f["sumilla"],
            "url_pdf": f["url_pdf"],
            "url_detalle": f["url_detalle"],
            "extraordinaria": f["extraordinaria"],
            "hash_unico": _hash(fecha, f),
        })
    return resultado
