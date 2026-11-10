"""Reconocimiento de texto (OCR) de PDF escaneados, con Tesseract (gratuito, corre en GitHub).

Se usa solo cuando el PDF no trae texto legible (es una imagen escaneada). Si Tesseract no esta
instalado, no hace nada y devuelve "" (el resto del sistema sigue igual).
"""
import os
import re
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

MAX_PAGINAS = int(os.getenv("OCR_MAX_PAGINAS", "80"))   # proyectos largos: basta con las primeras 80 paginas
SEGUNDOS_POR_PAGINA = 120
IDIOMA = os.getenv("OCR_IDIOMA", "spa")


def disponible() -> bool:
    return bool(shutil.which("tesseract") and shutil.which("pdftoppm"))


def _paginas(ruta) -> int:
    try:
        salida = subprocess.run(["pdfinfo", ruta], capture_output=True, text=True, timeout=60).stdout
        m = re.search(r"^Pages:\s+(\d+)", salida, re.M)
        return int(m.group(1)) if m else MAX_PAGINAS
    except Exception:  # noqa: BLE001
        return MAX_PAGINAS


def _pagina(ruta, d, p) -> str:
    base = os.path.join(d, f"p{p}")
    try:
        subprocess.run(["pdftoppm", "-r", "200", "-gray", "-png", "-f", str(p), "-l", str(p),
                        "-singlefile", ruta, base], check=True, capture_output=True, timeout=SEGUNDOS_POR_PAGINA)
        r = subprocess.run(["tesseract", f"{base}.png", "stdout", "-l", IDIOMA, "--psm", "3"],
                           capture_output=True, timeout=SEGUNDOS_POR_PAGINA,
                           env={**os.environ, "OMP_THREAD_LIMIT": "1"})
        return r.stdout.decode("utf-8", "ignore")
    except Exception:  # noqa: BLE001  (una pagina dañada no detiene el resto)
        return ""
    finally:
        if os.path.exists(f"{base}.png"):
            os.remove(f"{base}.png")


def paginas_ocr(datos: bytes, max_paginas: int = MAX_PAGINAS, limite_segundos: float = 1800,
                maximo: int = 10**9) -> list:
    """Texto de cada pagina de un PDF escaneado. Lee varias paginas a la vez (una por nucleo)."""
    if not datos or not disponible():
        return []
    fin = time.time() + limite_segundos
    hilos = max(1, os.cpu_count() or 1)
    partes, total = [], 0
    with tempfile.TemporaryDirectory() as d:
        ruta = os.path.join(d, "doc.pdf")
        with open(ruta, "wb") as f:
            f.write(datos)
        paginas = list(range(1, min(_paginas(ruta), max_paginas) + 1))
        with ThreadPoolExecutor(hilos) as pool:
            for i in range(0, len(paginas), hilos):
                if time.time() > fin or total >= maximo:
                    break
                for t in pool.map(lambda p: _pagina(ruta, d, p), paginas[i:i + hilos]):
                    partes.append(t)
                    total += len(t)
    return partes


def texto_ocr(datos: bytes, maximo: int = 200_000, limite_segundos: float = 1800) -> str:
    """Texto de un PDF escaneado (hasta MAX_PAGINAS paginas)."""
    texto = "\n".join(paginas_ocr(datos, MAX_PAGINAS, limite_segundos, maximo))
    texto = re.sub(r"-\n(?=[a-záéíóúñ])", "", texto)
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.replace("\x00", "").strip()[:maximo]
