"""Bases de datos del sistema (todas en Neon, plan gratuito).

- Base PRINCIPAL: secreto TEXTOS_URL_4 (normas-textos-4). Normas, proyectos, analisis, usuarios.
  Las tareas la reciben como DATABASE_URL.
- Bases de TEXTO: secretos TEXTOS_URL_2, 3, 5 a 12. Guardan el texto completo de normas y proyectos
  (tabla "documentos"). La 1 se retiro: su contenido se copio a la 12.
- Base de CONTROL: TEXTOS_URL_2 (tambien es de texto). Guarda el avance del indexado y la medicion
  de transferencia (tabla "cupos").
"""
import os

PRINCIPAL = 4
RETIRADAS = (1,)
CONTROL = int(os.getenv("TEXTOS_CONTROL", "2"))


def url_principal() -> str:
    return (os.getenv("DATABASE_URL") or os.getenv(f"TEXTOS_URL_{PRINCIPAL}", "")).strip()


def bases_texto() -> list:
    """[(numero, url)] de las bases de texto configuradas en esta tarea."""
    salida = []
    for i in range(1, 13):
        if i == PRINCIPAL or (i in RETIRADAS and os.getenv("TEXTOS_URL_12", "").strip()):
            continue
        url = os.getenv(f"TEXTOS_URL_{i}", "").strip()
        if url:
            salida.append((i, url))
    return salida


def control_url() -> str:
    return os.getenv(f"TEXTOS_URL_{CONTROL}", "").strip()
