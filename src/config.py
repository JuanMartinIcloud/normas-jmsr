"""Configuracion central. Todo se puede sobreescribir con variables de entorno."""
import os

import neon_urls

neon_urls.completar_entorno()   # direcciones de las bases a partir de NEON_API_KEY

BASE_URL = "https://diariooficial.elperuano.pe"

# Endpoint real confirmado con el sondeo: formulario POST con fechas dd/mm/aaaa
ENDPOINT = f"{BASE_URL}/Normas/Filtro"
FORMATO_FECHA = "%d/%m/%Y"

# Cortesia con el servidor: segundos de espera entre solicitudes
PAUSA_SEGUNDOS = float(os.getenv("PAUSA_SEGUNDOS", "1.5"))
REINTENTOS = int(os.getenv("REINTENTOS", "4"))
TIMEOUT = int(os.getenv("TIMEOUT", "60"))

USER_AGENT = os.getenv(
    "USER_AGENT", "Mozilla/5.0 (compatible; normas-jmsr-research/0.1; uso academico)"
)

DATABASE_URL = os.getenv("DATABASE_URL", "")  # cadena de conexion de la base principal (Neon)
