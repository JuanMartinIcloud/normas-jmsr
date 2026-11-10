"""Copia los datos del sistema anterior (normas-peru) a las bases nuevas de normas-jmsr.

Dos pasos (se elige en la tarea «Copiar datos del sistema anterior»):
  revisar  Solo lee: muestra cada base del sistema anterior (nombre, tamano, tablas y filas). No copia nada.
  copiar   Copia. Se puede repetir: lo que ya se copio no se duplica (se salta).

Que se copia (lo publico, que el sistema nuevo vuelve a usar):
  base principal  normas, descargas, proyectos_ley, seguimientos, resumenes, vocabulario
  bases de texto  documentos (texto completo), y en la base de control: avance y ocr_revisado
Que NO se copia: usuarios, claves, busquedas guardadas, informes, correos, consultas a la IA, consumo y
el analisis de AmCham. El sistema nuevo tiene sus propios usuarios y su propio monitoreo por areas.

Secretos: NEON_API_KEY (cuenta nueva) y NEON_API_KEY_ANTERIOR (cuenta del sistema anterior).
Nunca imprime direcciones ni claves.
"""
import argparse
import os
import sys
import tempfile
import time

import psycopg2
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import neon_urls  # noqa: E402

API = neon_urls.API
RAIZ = os.path.join(os.path.dirname(__file__), "..")
TABLAS_PRINCIPAL = ["normas", "descargas", "proyectos_ley", "seguimientos", "resumenes", "vocabulario"]
TABLAS_CONTROL = ["avance", "ocr_revisado"]
LIMITE_MB = 900   # espacio que se llena de cada base nueva de texto (Neon gratis: 1024 MB)


def p(*a):
    print(*a, flush=True)


def ocultar(uri):
    if os.getenv("GITHUB_ACTIONS"):
        p(f"::add-mask::{uri}")


def bases_anteriores(clave):
    """[(nombre del proyecto, direccion)] de todas las bases de la cuenta anterior."""
    salida = []
    for org in neon_urls.organizaciones(clave):
        params = {"limit": 100, **({"org_id": org["id"]} if org else {})}
        for q in neon_urls._pedir("/projects", clave, **params).get("projects", []):
            rama = next((b for b in neon_urls._pedir(f"/projects/{q['id']}/branches", clave)["branches"]
                         if b.get("default")), None)
            if not rama:
                continue
            for bd in neon_urls._pedir(f"/projects/{q['id']}/branches/{rama['id']}/databases", clave)["databases"]:
                uri = neon_urls._pedir(f"/projects/{q['id']}/connection_uri", clave, branch_id=rama["id"],
                                       database_name=bd["name"], role_name=bd["owner_name"])["uri"]
                ocultar(uri)
                salida.append((q["name"] if bd["name"] == "neondb" else f"{q['name']}/{bd['name']}", uri))
    return sorted(salida)


def conectar(uri):
    for intento in range(5):
        try:
            return psycopg2.connect(uri, connect_timeout=60, keepalives=1, keepalives_idle=30)
        except psycopg2.OperationalError as e:
            if intento == 4:
                raise
            p(f"  la base no responde todavia ({str(e).splitlines()[0][:80]}); reintento en 20 s")
            time.sleep(20)


def describir(uri):
    """{tabla: filas} y tamano en MB de una base."""
    c = conectar(uri)
    cur = c.cursor()
    cur.execute("""SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname""")
    tablas = dict(cur.fetchall())
    for t in ("normas", "documentos"):
        if t in tablas:
            cur.execute(f"SELECT count(*) FROM {t}")
            tablas[t] = cur.fetchone()[0]
    cur.execute("SELECT pg_database_size(current_database()) / 1e6")
    mb = float(cur.fetchone()[0])
    c.close()
    return tablas, mb


def columnas(cur, tabla):
    cur.execute("""SELECT column_name FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position""", (tabla,))
    return [r[0] for r in cur.fetchall()]


def copiar_tabla(origen, destino, tabla, donde=""):
    """Copia una tabla completa; las filas que ya existen en el destino se saltan."""
    co, cd = origen.cursor(), destino.cursor()
    cols_o, cols_d = columnas(co, tabla), columnas(cd, tabla)
    if not cols_o:
        p(f"  {tabla}: no existe en el origen, se salta")
        return 0
    cols = [x for x in cols_o if x in cols_d]
    lista = ", ".join(f'"{x}"' for x in cols)
    with tempfile.TemporaryFile() as f:
        co.copy_expert(f"COPY (SELECT {lista} FROM {tabla} {donde}) TO STDOUT", f)
        origen.commit()
        mb = f.tell() / 1e6
        f.seek(0)
        cd.execute(f"CREATE TEMP TABLE _carga (LIKE {tabla} INCLUDING DEFAULTS) ON COMMIT DROP")
        cd.copy_expert(f"COPY _carga ({lista}) FROM STDIN", f)
        cd.execute(f"INSERT INTO {tabla} ({lista}) SELECT {lista} FROM _carga ON CONFLICT DO NOTHING")
        nuevas = cd.rowcount
        if "id" in cols:
            cd.execute(f"""SELECT setval(pg_get_serial_sequence('{tabla}', 'id'), greatest(1, (SELECT max(id) FROM {tabla})))
                           WHERE pg_get_serial_sequence('{tabla}', 'id') IS NOT NULL""")
        destino.commit()
    p(f"  {tabla}: {nuevas} filas nuevas ({mb:.0f} MB leidos)")
    return nuevas


def preparar_principal(uri):
    import vocabulario
    c = conectar(uri)
    cur = c.cursor()
    cur.execute(open(os.path.join(RAIZ, "schema.sql"), encoding="utf-8").read())
    cur.execute(vocabulario.SQL_TABLA)
    c.commit()
    return c


def preparar_texto(uri, control):
    import indexar
    import ocr_pendientes
    c = conectar(uri)
    cur = c.cursor()
    # La tabla sin su indice de busqueda: el indice se crea al final (asi la carga es mucho mas rapida)
    sql = indexar.SQL_BASE_TEXTOS.split("CREATE INDEX")[0] + indexar.SQL_BASE_TEXTOS.split("WITH (fastupdate = off);")[1]
    cur.execute(sql)
    if control:
        cur.execute(ocr_pendientes.SQL_CONTROL)
    c.commit()
    return c


def indice_texto(c):
    import indexar
    cur = c.cursor()
    cur.execute("SET maintenance_work_mem = '256MB'")
    i = indexar.SQL_BASE_TEXTOS.index("CREATE INDEX")
    cur.execute(indexar.SQL_BASE_TEXTOS[i:indexar.SQL_BASE_TEXTOS.index(";", i) + 1])
    c.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modo", choices=["revisar", "copiar"], default="revisar")
    ap.add_argument("--excluir", default="", help="nombres de proyectos anteriores que no se copian, separados por comas")
    a = ap.parse_args()
    excluir = {x.strip() for x in a.excluir.split(",") if x.strip()}

    anteriores = bases_anteriores(os.environ["NEON_API_KEY_ANTERIOR"].strip())
    p(f"Bases del sistema anterior: {len(anteriores)}")
    principal, textos = None, []
    for nombre, uri in anteriores:
        tablas, mb = describir(uri)
        resumen = ", ".join(f"{t} {n}" for t, n in sorted(tablas.items()))
        marca = " (EXCLUIDA)" if nombre in excluir else ""
        p(f"- {nombre}{marca}: {mb:.0f} MB | {resumen or 'sin tablas'}")
        if nombre in excluir:
            continue
        if "normas" in tablas:
            if principal:
                raise SystemExit(f"::error::Hay dos bases con normas ({principal[0]} y {nombre}): excluir una.")
            principal = (nombre, uri)
        elif tablas.get("documentos"):
            textos.append((nombre, uri, mb, "avance" in tablas))
    if not principal:
        raise SystemExit("::error::No se encontro la base principal del sistema anterior.")
    if sum(1 for t in textos if t[3]) > 1:
        raise SystemExit("::error::Hay mas de una base con la tabla de avance: excluir la que no corresponde.")

    nuevas = neon_urls.direcciones(os.environ["NEON_API_KEY"].strip())
    for uri in nuevas.values():
        ocultar(uri)
    destinos_texto = [n for n in (2, 3, 5, 6, 7, 8, 9) if n in nuevas]
    if 4 not in nuevas or len(destinos_texto) < 7:
        raise SystemExit("::error::Faltan bases nuevas en Neon (deben ser 8).")

    # Reparto: la base anterior con el avance va a la base nueva de control (textos-1); las demas, de la
    # mas grande a la mas chica, a la base nueva que tenga menos ocupado, sin pasar de 900 MB.
    ocupado = {n: 0.0 for n in destinos_texto}
    plan = []
    for nombre, uri, mb, control in sorted(textos, key=lambda t: (not t[3], -t[2])):
        n = 2 if control else min(destinos_texto, key=lambda x: ocupado[x])
        if ocupado[n] + mb > LIMITE_MB:
            raise SystemExit(f"::error::{nombre} ({mb:.0f} MB) no cabe en ninguna base nueva.")
        ocupado[n] += mb
        plan.append((nombre, uri, n, control))
    inv = {v: k for k, v in neon_urls.NUMEROS.items()}
    p("\nPlan de copia:")
    p(f"  {principal[0]} -> {inv[4]} (tablas: {', '.join(TABLAS_PRINCIPAL)})")
    for nombre, _u, n, control in plan:
        p(f"  {nombre} -> {inv[n]}" + (" (con el avance del indexado)" if control else ""))
    if a.modo == "revisar":
        p("\nModo revisar: no se copio nada.")
        return

    t0 = time.time()
    p(f"\nBase principal: {principal[0]} -> {inv[4]}")
    o = conectar(principal[1])
    d = preparar_principal(nuevas[4])
    for t in TABLAS_PRINCIPAL:
        copiar_tabla(o, d, t)
    o.close()
    from areas_base import AREAS_BASE   # lista inicial de areas (asi la web ya las muestra)
    from psycopg2.extras import execute_values
    with d.cursor() as cur:
        execute_values(cur, "INSERT INTO areas (nombre, descripcion, origen) VALUES %s ON CONFLICT (nombre) DO NOTHING",
                       [(n, x, "base") for n, x in AREAS_BASE])
        p(f"  areas iniciales: {cur.rowcount} nuevas")
    d.commit()
    d.close()
    for nombre, uri, n, control in plan:
        p(f"\nTexto: {nombre} -> {inv[n]}")
        o = conectar(uri)
        d = preparar_texto(nuevas[n], control or n == 2)
        copiar_tabla(o, d, "documentos")
        if control:
            for t in TABLAS_CONTROL:
                copiar_tabla(o, d, t)
        p("  creando el indice de busqueda...")
        indice_texto(d)
        o.close()
        d.close()
    # Bases nuevas que quedaron sin copia: igual se preparan (tabla e indice) para que el sistema las use
    for n in destinos_texto:
        if not any(x[2] == n for x in plan):
            d = preparar_texto(nuevas[n], n == 2)
            indice_texto(d)
            d.close()

    p("\nComprobacion (filas en el sistema anterior / en el nuevo):")
    errores = 0
    o, d = conectar(principal[1]), conectar(nuevas[4])
    for t in TABLAS_PRINCIPAL:
        co, cd = o.cursor(), d.cursor()
        try:
            co.execute(f"SELECT count(*) FROM {t}")
            antes = co.fetchone()[0]
        except psycopg2.Error:
            o.rollback()
            continue
        cd.execute(f"SELECT count(*) FROM {t}")
        ahora = cd.fetchone()[0]
        errores += ahora < antes
        p(f"  {t}: {antes} / {ahora} {'OK' if ahora >= antes else 'FALTAN'}")
    total_antes = 0
    for nombre, uri, _n, _c in plan:
        c = conectar(uri)
        cur = c.cursor()
        cur.execute("SELECT count(*) FROM documentos")
        total_antes += cur.fetchone()[0]
        c.close()
    total_ahora = 0
    for n in destinos_texto:
        c = conectar(nuevas[n])
        cur = c.cursor()
        cur.execute("SELECT count(*) FROM documentos")
        total_ahora += cur.fetchone()[0]
        c.close()
    errores += total_ahora < total_antes
    p(f"  documentos (texto completo): {total_antes} / {total_ahora} {'OK' if total_ahora >= total_antes else 'FALTAN'}")
    p(f"\nTiempo: {(time.time() - t0) / 60:.0f} min")
    if errores:
        raise SystemExit("::error::La copia no esta completa: volver a lanzarla (salta lo ya copiado).")


if __name__ == "__main__":
    main()
