"""Acceso a Neon (PostgreSQL)."""
import os

import psycopg2
from psycopg2.extras import execute_values

import config
import cupos

_ESQUEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "schema.sql")
# Cada etapa: (marca en schema.sql, consulta que dice si ya esta aplicada)
_ETAPAS = [
    ("-- Etapa 3:", """SELECT EXISTS (SELECT 1 FROM information_schema.tables
                                     WHERE table_schema = 'public' AND table_name = 'resumenes')
                         AND EXISTS (SELECT 1 FROM information_schema.columns
                                     WHERE table_schema = 'public' AND table_name = 'proyectos_ley'
                                       AND column_name = 'estado_cambiado_en')"""),
    ("-- Etapa 4:", """SELECT EXISTS (SELECT 1 FROM pg_indexes
                                     WHERE schemaname = 'public' AND indexname = 'idx_proy_busqueda')"""),
    ("-- Etapa 6:", """SELECT EXISTS (SELECT 1 FROM information_schema.tables
                                     WHERE table_schema = 'public' AND table_name = 'informes')
                         AND EXISTS (SELECT 1 FROM information_schema.columns
                                     WHERE table_schema = 'public' AND table_name = 'proyectos_ley'
                                       AND column_name = 'seguimiento_revisado')"""),
    ("-- Etapa 7:", """SELECT EXISTS (SELECT 1 FROM information_schema.columns
                                     WHERE table_schema = 'public' AND table_name = 'analisis'
                                       AND column_name = 'criterio')"""),
    ("-- Etapa 8:", """SELECT EXISTS (SELECT 1 FROM information_schema.columns
                                     WHERE table_schema = 'public' AND table_name = 'proyectos_ley'
                                       AND column_name = 'enlace_estado')"""),
    ("-- Etapa 9:", """SELECT EXISTS (SELECT 1 FROM pg_indexes
                                     WHERE schemaname = 'public' AND indexname = 'idx_normas_numero')"""),
    ("-- Etapa 10:", """SELECT NOT EXISTS (SELECT 1 FROM information_schema.tables
                                         WHERE table_schema = 'public' AND table_name = 'textos')"""),
    ("-- Etapa 11:", """SELECT EXISTS (SELECT 1 FROM information_schema.tables
                                     WHERE table_schema = 'public' AND table_name = 'analisis_pedidos')
                         AND EXISTS (SELECT 1 FROM information_schema.columns
                                     WHERE table_schema = 'public' AND table_name = 'analisis' AND column_name = 'manual')"""),
    ("-- Etapa 12:", """SELECT EXISTS (SELECT 1 FROM pg_indexes
                                     WHERE schemaname = 'public' AND indexname = 'idx_uso_ia_fecha')"""),
    ("-- Etapa 13:", """SELECT EXISTS (SELECT 1 FROM information_schema.columns
                                     WHERE table_schema = 'public' AND table_name = 'normas' AND column_name = 'rubro_ia')"""),
    ("-- Etapa 14:", """SELECT EXISTS (SELECT 1 FROM information_schema.tables
                                     WHERE table_schema = 'public' AND table_name = 'control_calidad')"""),
    ("-- Etapa 15:", """SELECT EXISTS (SELECT 1 FROM information_schema.columns
                                     WHERE table_schema = 'public' AND table_name = 'proyectos_ley' AND column_name = 'rubro_ia')"""),
]


def conectar():
    if not config.DATABASE_URL:
        raise SystemExit("Falta la variable de entorno DATABASE_URL (cadena de conexion de Neon).")
    if cupos.principal_en_emergencia():
        raise SystemExit(0)
    conn = psycopg2.connect(config.DATABASE_URL, connect_timeout=60)
    if not _esquema_revisado[0]:
        asegurar_esquema(conn)   # una sola vez por ejecucion (no en cada conexion)
        _esquema_revisado[0] = True
    return conn


_esquema_revisado = [False]


def asegurar_esquema(conn):
    """Aplica una sola vez los cambios de cada etapa de schema.sql que falten.

    En las ejecuciones siguientes solo hace una consulta rapida por etapa.
    """
    texto = None
    for n, (marca, consulta) in enumerate(_ETAPAS):
        with conn.cursor() as cur:
            cur.execute(consulta)
            lista = cur.fetchone()[0]
        conn.commit()
        if lista:
            continue
        if texto is None:
            with open(_ESQUEMA, encoding="utf-8") as f:
                texto = f.read()
        ini = texto.find(marca)
        if ini < 0:
            raise RuntimeError(f"No encontre la seccion '{marca}' en schema.sql")
        sig = _ETAPAS[n + 1][0] if n + 1 < len(_ETAPAS) else None
        fin = texto.find(sig, ini) if sig else -1
        bloque = texto[ini:fin] if fin > 0 else texto[ini:]
        with conn.cursor() as cur:
            # Candado: si dos tareas arrancan a la vez, la segunda espera a que la primera termine
            cur.execute("SELECT pg_advisory_xact_lock(724501)")
            cur.execute(bloque)
        conn.commit()
        print(f"Base de datos actualizada ({marca.strip('- :')}).")


def insertar_normas(conn, filas: list[dict]) -> int:
    if not filas:
        return 0
    cols = ["fecha", "tipo", "numero", "entidad", "sector", "rubro",
            "sumilla", "url_pdf", "url_detalle", "extraordinaria", "hash_unico"]
    valores = [[f[c] for c in cols] for f in filas]
    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO normas ({', '.join(cols)}) VALUES %s ON CONFLICT (hash_unico) DO NOTHING",
            valores,
        )
        n = cur.rowcount
    conn.commit()
    return n


def marcar_dia(conn, fecha, estado: str, cantidad: int = 0, detalle: str = ""):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO descargas (fecha, estado, cantidad, detalle)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (fecha) DO UPDATE
               SET estado = EXCLUDED.estado, cantidad = EXCLUDED.cantidad,
                   detalle = EXCLUDED.detalle, actualizado = now()""",
            (fecha, estado, cantidad, detalle[:500]),
        )
    conn.commit()


def dias_pendientes(conn, desde, hasta) -> list:
    """Fechas del rango que aun no estan en 'ok' o 'vacio' (para reanudar)."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT d::date FROM generate_series(%s::date, %s::date, interval '1 day') d
               WHERE d::date NOT IN (SELECT fecha FROM descargas WHERE estado IN ('ok','vacio'))
               ORDER BY d DESC""",
            (desde, hasta),
        )
        return [r[0] for r in cur.fetchall()]


def upsert_proyectos(conn, filas: list[dict]) -> int:
    """Inserta proyectos de ley; si ya existen, actualiza su estado y datos.

    Si el estado cambia, anota la hora en 'estado_cambiado_en' (lo usa el resumen diario).
    """
    if not filas:
        return 0
    cols = ["periodo", "camara", "numero", "num_pley", "fecha_presentacion",
            "titulo", "autor", "proponente", "estado", "rubro", "url", "camara_actual"]
    valores = [[f.get(c) for c in cols] for f in filas]
    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""INSERT INTO proyectos_ley ({', '.join(cols)}) VALUES %s
                ON CONFLICT (periodo, camara, numero) DO UPDATE SET
                    estado_cambiado_en = CASE
                        WHEN EXCLUDED.estado IS NOT NULL
                         AND proyectos_ley.estado IS DISTINCT FROM EXCLUDED.estado THEN now()
                        ELSE proyectos_ley.estado_cambiado_en END,
                    estado = COALESCE(EXCLUDED.estado, proyectos_ley.estado),
                    titulo = EXCLUDED.titulo, autor = EXCLUDED.autor,
                    proponente = EXCLUDED.proponente,
                    -- el rubro que puso la IA se conserva si las reglas no encuentran otro
                    rubro = CASE WHEN proyectos_ley.rubro_ia AND EXCLUDED.rubro = 'Sin clasificar' THEN proyectos_ley.rubro ELSE EXCLUDED.rubro END,
                    url = COALESCE(EXCLUDED.url, proyectos_ley.url),
                    camara_actual = COALESCE(EXCLUDED.camara_actual, proyectos_ley.camara_actual),
                    fecha_presentacion = EXCLUDED.fecha_presentacion, actualizado = now()
                -- Solo se escribe si algo cambio (antes se reescribian los ~15.600 proyectos en cada descarga)
                WHERE (proyectos_ley.estado, proyectos_ley.titulo, proyectos_ley.autor, proyectos_ley.proponente,
                       proyectos_ley.rubro, proyectos_ley.url, proyectos_ley.camara_actual,
                       proyectos_ley.fecha_presentacion)
                      IS DISTINCT FROM
                      (COALESCE(EXCLUDED.estado, proyectos_ley.estado), EXCLUDED.titulo, EXCLUDED.autor,
                       EXCLUDED.proponente, CASE WHEN proyectos_ley.rubro_ia AND EXCLUDED.rubro = 'Sin clasificar' THEN proyectos_ley.rubro ELSE EXCLUDED.rubro END,
                       COALESCE(EXCLUDED.url, proyectos_ley.url),
                       COALESCE(EXCLUDED.camara_actual, proyectos_ley.camara_actual),
                       EXCLUDED.fecha_presentacion)""",
            valores,
        )
    conn.commit()
    return len(filas)
