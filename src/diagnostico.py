"""Diagnostico de SOLO LECTURA (no cambia nada en ninguna base).

    python src/diagnostico.py neon        # transferencia, computo y espacio de cada proyecto (API de Neon)
    python src/diagnostico.py consultas   # consultas que mas filas devolvieron en la base principal
    python src/diagnostico.py conteos     # conteos de control del sistema
    python src/diagnostico.py seguridad   # usuarios, permisos, funciones y disparadores de cada base
    python src/diagnostico.py web         # comprueba desde afuera que la web este cerrada (sin usuario)
    python src/diagnostico.py ia          # cuanto trabajo de IA tiene cada mes y cuanto se gasto por dia
    python src/diagnostico.py auditoria   # auditoria completa de los datos: que esta completo y que falta

El resultado se muestra como un aviso de la ejecucion en GitHub (no se guarda en el repositorio).
"""
import os
from datetime import timedelta
import sys

import psycopg2
import requests

import bases

API = "https://console.neon.tech/api/v2"
PREFIJO = "normas-textos-"   # nombre de los proyectos de Neon de este sistema
lineas = []


def p(*x):
    lineas.append(" ".join(str(i) for i in x))


def neon():
    h = {"Authorization": f"Bearer {os.environ['NEON_API_KEY']}", "Accept": "application/json"}
    orgs = requests.get(f"{API}/users/me/organizations", headers=h, timeout=60).json().get("organizations") or []
    p(f"cuenta de Neon: verificacion en dos pasos exigida = {[o.get('require_mfa') for o in orgs]}")
    params = {"limit": 100, **({"org_id": orgs[0]["id"]} if orgs else {})}
    for q in requests.get(f"{API}/projects", headers=h, params=params, timeout=60).json().get("projects", []):
        if not str(q.get("name", "")).startswith(PREFIJO):
            continue   # otros proyectos de la cuenta: no son de este sistema y no se muestran (el registro es publico)
        d = requests.get(f"{API}/projects/{q['id']}", headers=h, timeout=60).json().get("project", {})
        br = requests.get(f"{API}/projects/{q['id']}/branches", headers=h, timeout=60).json().get("branches", [])
        tam = sum(b.get("logical_size") or 0 for b in br)
        ajustes = d.get("settings") or {}
        p(f"{d.get('name')}: IPs permitidas {(ajustes.get('allowed_ips') or {}).get('ips') or 'todas'}, "
          f"solo conexiones privadas {ajustes.get('block_public_connections')}")
        p(f"{d.get('name')}: transferencia {(d.get('data_transfer_bytes') or 0) / 1e9:.2f} GB, "
          f"computo {(d.get('compute_time_seconds') or 0) / 3600:.1f} h, espacio {tam / 1e6:.0f} MB, "
          f"limite de espacio {d.get('branch_logical_size_limit')} MiB, periodo desde {d.get('consumption_period_start')}")


def consultas():
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("SELECT stats_reset FROM pg_stat_statements_info")
    p("estadisticas desde:", cur.fetchone()[0])
    cur.execute("""SELECT calls, rows, regexp_replace(left(query, 200), '\\s+', ' ', 'g')
                   FROM pg_stat_statements ORDER BY rows DESC LIMIT 30""")
    for llamadas, filas, q in cur.fetchall():
        p(f"{llamadas} veces, {filas} filas: {q}")
    c.close()


def conteos():
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    for titulo, sql in (
        ("proyectos sin sumilla revisada", "SELECT count(*) FROM proyectos_ley WHERE sumilla_revisada IS NOT TRUE"),
        ("proyectos", "SELECT count(*) FROM proyectos_ley"),
        ("normas", "SELECT count(*) FROM normas"),
        ("analisis", "SELECT count(*) FROM analisis"),
        ("tamano de la base principal (MB)", "SELECT pg_database_size(current_database()) / 1e6"),
    ):
        cur.execute(sql)
        p(f"{titulo}: {cur.fetchone()[0]}")
    c.close()


def seguridad():
    """Revision de seguridad de cada base (solo lectura). No muestra datos, solo la configuracion."""
    lista = [("principal", bases.url_principal())] + [(f"texto {i}", u) for i, u in bases.bases_texto()]
    for nombre, url in lista:
        if not url:
            continue
        try:
            c = psycopg2.connect(url, connect_timeout=60)
            cur = c.cursor()
            cur.execute("""SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles
                           WHERE rolname NOT LIKE 'pg\\_%' ORDER BY 1""")
            roles = [f"{r[0]}{'(login)' if r[1] else ''}{'(SUPER)' if r[2] else ''}{'(crea-roles)' if r[3] else ''}" for r in cur.fetchall()]
            cur.execute("SELECT has_schema_privilege('public', 'public', 'CREATE'), has_database_privilege('public', current_database(), 'CONNECT')")
            pub_crear, pub_conectar = cur.fetchone()
            cur.execute("""SELECT count(*) FROM information_schema.role_table_grants
                           WHERE grantee = 'PUBLIC' AND table_schema = 'public'""")
            pub_tablas = cur.fetchone()[0]
            cur.execute("""SELECT p.proname || ' (' || CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'normal' END || ')'
                           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                           LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
                           WHERE n.nspname = 'public' AND d.objid IS NULL""")
            funciones = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT tgname || ' en ' || tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal")
            disparadores = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT extname FROM pg_extension ORDER BY 1")
            ext = [r[0] for r in cur.fetchall()]
            cur.execute("""SELECT n.nspname FROM pg_namespace n WHERE n.nspname NOT IN ('public', 'information_schema')
                           AND n.nspname NOT LIKE 'pg\\_%'""")
            esquemas = [r[0] for r in cur.fetchall()]
            cur.execute("""SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1""")
            tablas = [r[0] for r in cur.fetchall()]
            cur.execute("""SELECT string_agg(relname || ' ' || pg_size_pretty(pg_total_relation_size(oid)) || ' (' ||
                                  reltuples::bigint || ' filas aprox.)', ', ')
                           FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
                             AND relname IN ('textos')""")
            viejas = cur.fetchone()[0]
            cur.execute("""SELECT string_agg(r.rolname || ' miembros:' || coalesce((SELECT string_agg(m.rolname, '/')
                                  FROM pg_auth_members a JOIN pg_roles m ON m.oid = a.member WHERE a.roleid = r.oid), '-')
                                  || ' tablas:' || (SELECT count(*) FROM information_schema.role_table_grants g
                                                    WHERE g.grantee = r.rolname AND g.table_schema = 'public'), ', ')
                           FROM pg_roles r WHERE r.rolname IN ('token_roles', 'authenticated', 'anonymous', 'authenticator')""")
            api_roles = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()")
            conexiones = cur.fetchone()[0]
            c.close()
            p(f"[{nombre}] roles: {', '.join(roles)} | PUBLIC puede crear objetos: {pub_crear} | PUBLIC puede conectarse: "
              f"{pub_conectar} | permisos de tablas a PUBLIC: {pub_tablas} | funciones propias: {funciones or 'ninguna'} | "
              f"disparadores: {disparadores or 'ninguno'} | extensiones: {ext} | otros esquemas: {esquemas or 'ninguno'} | "
              f"tablas: {tablas} | tablas antiguas: {viejas or 'ninguna'} | roles de acceso por API: {api_roles or 'ninguno'} | "
              f"otras conexiones abiertas: {conexiones}")
        except Exception as e:  # noqa: BLE001
            p(f"[{nombre}] no se pudo revisar: {type(e).__name__}")


def web():
    """Pruebas desde afuera, sin usuario: nada debe mostrar datos."""
    sitio = os.getenv("SITIO_WEB", "https://normas-jmsr.vercel.app").rstrip("/")
    nav = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"}
    falsa = {"Cookie": "sesion=1.99999999999999." + "a" * 64, **nav}
    pruebas = [
        ("portada sin usuario (espera 307 a /ingresar)", "GET", "/", nav),
        ("proyectos sin usuario (espera 307)", "GET", "/proyectos?q=agua", nav),
        ("monitoreo sin usuario (espera 307)", "GET", "/monitoreo", nav),
        ("descarga Excel sin usuario (espera 401)", "GET", "/api/csv", nav),
        ("estado del sistema sin usuario (espera 401)", "GET", "/api/estado", nav),
        ("IA sin usuario (espera 401)", "POST", "/api/ia/resumir", nav),
        ("robot de Google (espera 403)", "GET", "/", {"User-Agent": "Googlebot/2.1"}),
        ("programa automatico (espera 403)", "GET", "/", {"User-Agent": "python-requests/2.32"}),
        ("sesion falsificada en pagina (no debe mostrar datos)", "GET", "/resumenes", falsa),
        ("sesion falsificada en descarga (espera 401)", "GET", "/api/csv", falsa),
        ("tarea de busquedas con clave falsa (espera 401)", "POST", "/api/busquedas/ejecutar",
         {"x-clave-tareas": "0" * 48, **nav}),
        ("optimizador de imagenes (espera 404)", "GET", "/_next/image?url=%2Fx.svg&w=64&q=75", nav),
        ("pagina de ingreso (espera 200)", "GET", "/ingresar", nav),
        ("robots.txt (espera 200)", "GET", "/robots.txt", nav),
    ]
    for titulo, metodo, ruta, cab in pruebas:
        try:
            r = requests.request(metodo, sitio + ruta, headers=cab, timeout=60, allow_redirects=False)
            extra = r.headers.get("location", "")
            if "falsificada en pagina" in titulo:
                extra = "sin datos" if ("no está disponible" in r.text or r.status_code in (307, 401)) and "sumilla" not in r.text else "MUESTRA DATOS"
            p(f"{titulo}: {r.status_code} {extra}")
        except Exception as e:  # noqa: BLE001
            p(f"{titulo}: error {type(e).__name__}")
    r = requests.get(sitio + "/ingresar", headers=nav, timeout=60)
    p("cabeceras: " + ", ".join(f"{k}={'si' if r.headers.get(k) else 'NO'}" for k in
                                ("x-robots-tag", "x-frame-options", "strict-transport-security", "x-content-type-options"))
      + f", x-powered-by={'PRESENTE' if r.headers.get('x-powered-by') else 'oculto'}")


def ia():
    """Cifras para calcular el cupo de la IA (solo conteos)."""
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    local = """(n.sector IN ('Gobiernos Locales', 'Gobiernos Regionales')
               OR upper(translate(n.tipo, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) ~ '^(ORDENANZA|DECRETO DE ALCALDIA|ACUERDO DE CONCEJO|RESOLUCION DE ALCALDIA|ACUERDO REGIONAL|RESOLUCION EJECUTIVA REGIONAL|ACUERDO DE CONSEJO REGIONAL)'
               OR upper(n.entidad) ~ '(MUNICIPALIDAD|GOBIERNO REGIONAL|CONSEJO REGIONAL)')"""
    rango = "n.tipo ~* '^\\s*(fe\\s+de\\s+erratas?\\s+)?(ley|decreto\\s+legislativo|decreto\\s+de\\s+urgencia|resoluci[oó]n\\s+legislativa)\\y'"
    cur.execute(f"""SELECT extract(year FROM n.fecha)::int, count(*), count(*) FILTER (WHERE NOT {local}),
                           count(*) FILTER (WHERE {rango})
                    FROM normas n GROUP BY 1 ORDER BY 1""")
    p("NORMAS por año (total | no locales | rango de ley):")
    for a, t, nl, r in cur.fetchall():
        p(f"  {a}: {t} | {nl} | {r}")
    cur.execute("""SELECT extract(year FROM fecha_presentacion)::int, count(*) FROM proyectos_ley
                   WHERE fecha_presentacion IS NOT NULL GROUP BY 1 ORDER BY 1""")
    p("PROYECTOS presentados por año: " + ", ".join(f"{a}: {n}" for a, n in cur.fetchall()))
    cur.execute(f"""SELECT to_char(n.fecha, 'YYYY-MM'), count(*), count(*) FILTER (WHERE NOT {local}),
                           count(a.id), count(*) FILTER (WHERE a.relevante),
                           count(*) FILTER (WHERE {rango} AND NOT {local})
                    FROM normas n LEFT JOIN analisis a ON a.tipo = 'N' AND a.ref_id = n.id
                    WHERE n.fecha >= '2026-01-01' GROUP BY 1 ORDER BY 1""")
    p("MESES 2026 normas (total | no locales | revisadas | relevantes | rango de ley no locales):")
    for m, t, nl, rv, rl, rg in cur.fetchall():
        p(f"  {m}: {t} | {nl} | {rv} | {rl} | {rg}")
    cur.execute("""SELECT to_char(a.fecha, 'YYYY-MM'), count(*), count(*) FILTER (WHERE a.relevante)
                   FROM analisis a WHERE a.tipo = 'P' AND a.fecha >= '2026-01-01' GROUP BY 1 ORDER BY 1""")
    p("MESES 2026 proyectos analizados (revisados | relevantes): " + ", ".join(f"{m}: {t}|{r}" for m, t, r in cur.fetchall()))
    cur.execute("""SELECT (creado_en AT TIME ZONE 'America/Los_Angeles')::date AS dia, coalesce(modelo, '(filtro o local)'), count(*)
                   FROM analisis WHERE creado_en > now() - interval '3 days' GROUP BY 1, 2 ORDER BY 1, 2""")
    p("ANALISIS guardados por dia (hora del Pacifico, cuando Google renueva el cupo) y modelo:")
    for d, m, n in cur.fetchall():
        p(f"  {d} {m}: {n}")
    try:
        # Cupo real por modelo y dia de Google (renueva a medianoche del Pacifico): consultas que respondieron,
        # cuantas dijeron "cupo agotado" y cuantas habian respondido antes del primer "cupo agotado"
        cur.execute("""WITH u AS (SELECT (creado_en AT TIME ZONE 'America/Los_Angeles')::date AS dia, modelo, resultado,
                                         creado_en FROM uso_ia),
                         p AS (SELECT dia, modelo, min(creado_en) AS primero FROM u WHERE resultado = 'cupo_dia' GROUP BY 1, 2)
                       SELECT u.dia, u.modelo, count(*) FILTER (WHERE resultado = 'ok'),
                              count(*) FILTER (WHERE resultado = 'cupo_minuto' OR resultado = 'cupo'),
                              count(*) FILTER (WHERE resultado = 'cupo_dia'),
                              count(*) FILTER (WHERE resultado = 'ok' AND (p.primero IS NULL OR u.creado_en < p.primero))
                       FROM u LEFT JOIN p USING (dia, modelo) GROUP BY 1, 2 ORDER BY 1, 2""")
        p("USO DE LA IA por dia y modelo (respondio | limite por minuto | limite del dia | respondio antes del limite del dia):")
        for d, m, ok, minuto, dia, antes in cur.fetchall():
            p(f"  {d} {m}: {ok} | {minuto} | {dia} | {antes}{'  <- LIMITE DEL DIA ALCANZADO' if dia else ''}")
        cur.execute("""SELECT (creado_en AT TIME ZONE 'America/Los_Angeles')::date, origen, count(*) FROM uso_ia
                       GROUP BY 1, 2 ORDER BY 1, 2""")
        p("USO DE LA IA por dia y origen: " + ", ".join(f"{d} {o}: {n}" for d, o, n in cur.fetchall()))
    except psycopg2.Error:
        c.rollback()
    try:
        cur.execute("""SELECT (creado_en AT TIME ZONE 'America/Los_Angeles')::date, tipo, count(*) FROM consultas_ia
                       WHERE creado_en > now() - interval '45 days' GROUP BY 1, 2 ORDER BY 1, 2""")
        p("CONSULTAS desde la web por dia: " + ", ".join(f"{d} {t}: {n}" for d, t, n in cur.fetchall()))
    except psycopg2.Error:
        c.rollback()
    c.close()


def auditoria():
    """Auditoria completa de los datos (solo lectura): que esta completo y que falta."""
    from datetime import date, timedelta
    hoy = date.today()
    ayer = hoy - timedelta(days=1)
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()

    def q(sql, args=()):
        cur.execute(sql, args)
        return cur.fetchall()

    def muestra(lista, n=25):
        lista = [str(x) for x in lista]
        return ", ".join(lista[:n]) + (f" ... (+{len(lista) - n})" if len(lista) > n else "")

    # ---------------------------------------------------------------- 1. normas
    p("=== 1. NORMAS DE EL PERUANO ===")
    [(total, primera, ultima)] = q("SELECT count(*), min(fecha), max(fecha) FROM normas")
    p(f"Total: {total} normas, del {primera} al {ultima}")
    sin_marca = [r[0] for r in q("""SELECT d::date FROM generate_series('2015-01-01'::date, %s::date, interval '1 day') d
                                    WHERE d::date NOT IN (SELECT fecha FROM descargas WHERE estado IN ('ok', 'vacio'))
                                    ORDER BY 1""", (ayer,))]
    p(f"Dias sin descarga confirmada (2015 a ayer): {len(sin_marca)}" + (f" -> {muestra(sin_marca)}" if sin_marca else ""))
    errores = [r[0] for r in q("SELECT fecha FROM descargas WHERE estado = 'error' ORDER BY 1")]
    p(f"Dias con error de descarga: {len(errores)}" + (f" -> {muestra(errores)}" if errores else ""))
    vacios = [r[0] for r in q("SELECT fecha FROM descargas WHERE estado = 'vacio' ORDER BY 1")]
    p(f"Dias que El Peruano no publico nada (marcados vacios): {len(vacios)}" + (f" -> {muestra(vacios, 40)}" if vacios else ""))
    distintos = q("""SELECT d.fecha, d.cantidad, count(n.id) FROM descargas d LEFT JOIN normas n ON n.fecha = d.fecha
                     WHERE d.estado = 'ok' GROUP BY 1, 2 HAVING count(n.id) < d.cantidad ORDER BY 1""")
    p(f"Dias con menos normas guardadas que las que tenia El Peruano al descargar: {len(distintos)}"
      + (f" -> {muestra([f'{f} ({g} de {e})' for f, e, g in distintos])}" if distintos else ""))
    bajos = q("""WITH d AS (SELECT fecha, count(*) n FROM normas GROUP BY 1),
                      m AS (SELECT extract(year FROM fecha) a, percentile_cont(0.5) WITHIN GROUP (ORDER BY n) med FROM d GROUP BY 1)
                 SELECT d.fecha, d.n, m.med::int FROM d JOIN m ON m.a = extract(year FROM d.fecha)
                 WHERE d.n < m.med * 0.2 AND extract(dow FROM d.fecha) BETWEEN 1 AND 5 ORDER BY 1""")
    p(f"Dias habiles con muy pocas normas (menos del 20% de lo normal en su año): {len(bajos)}"
      + (f" -> {muestra([f'{f} ({n}, normal {m})' for f, n, m in bajos])}" if bajos else ""))
    [(sin_sumilla, sin_enlace, sin_tipo, sin_entidad)] = q("""SELECT count(*) FILTER (WHERE coalesce(sumilla, '') = ''),
        count(*) FILTER (WHERE url_detalle IS NULL), count(*) FILTER (WHERE coalesce(tipo, '') = ''),
        count(*) FILTER (WHERE coalesce(entidad, '') = '') FROM normas""")
    p(f"Normas sin sumilla: {sin_sumilla}; sin enlace a El Peruano: {sin_enlace}; sin tipo: {sin_tipo}; sin entidad: {sin_entidad}")
    [(dup,)] = q("""SELECT count(*) FROM (SELECT 1 FROM normas WHERE coalesce(numero, '') <> ''
                    GROUP BY fecha, lower(tipo), numero, entidad HAVING count(*) > 1) x""")
    p(f"Normas repetidas (mismo dia, tipo, numero y entidad): {dup}")
    [(sin_clas,)] = q("SELECT count(*) FROM normas WHERE rubro = 'Sin clasificar' OR sector = 'Otros'")
    p(f"Normas sin rubro o sector reconocido (Sin clasificar / Otros): {sin_clas} de {total}")

    # ---------------------------------------------------------------- 2. proyectos
    p("=== 2. PROYECTOS DE LEY ===")
    nuestros = {(str(a), b): n for a, b, n in q("SELECT periodo, camara, count(*) FROM proyectos_ley GROUP BY 1, 2")}
    try:
        import congreso
        for per in congreso.periodos():
            for cam in congreso.CAMARAS:
                datos = congreso._con_reintentos(congreso._s.post, f"{congreso.API}/proyecto-ley/lista-con-filtro",
                                                 json=congreso._cuerpo(per["perParId"], cam, 0))["data"]
                oficial = datos.get("rowsTotal") or 0
                propio = nuestros.get((str(per["perParId"]), cam), 0)
                if oficial or propio:
                    p(f"Periodo {per.get('desPerParAbrev')} camara {cam}: Congreso {oficial}, sistema {propio}"
                      + ("" if oficial == propio else f"  <- DIFERENCIA {propio - oficial:+d}"))
    except Exception as e:  # noqa: BLE001
        p(f"No se pudo comparar con el portal del Congreso: {type(e).__name__}")
    [(tp, sin_estado, sin_fecha, sin_titulo, sin_num)] = q("""SELECT count(*), count(*) FILTER (WHERE coalesce(estado, '') = ''),
        count(*) FILTER (WHERE fecha_presentacion IS NULL), count(*) FILTER (WHERE coalesce(titulo, '') = ''),
        count(*) FILTER (WHERE num_pley IS NULL) FROM proyectos_ley""")
    p(f"Total: {tp}; sin estado: {sin_estado}; sin fecha de presentacion: {sin_fecha}; sin titulo: {sin_titulo}; sin numero del portal: {sin_num}")
    [(act, nunca, viejo, sin_mov)] = q("""SELECT count(*), count(*) FILTER (WHERE seguimiento_revisado IS NULL),
        count(*) FILTER (WHERE seguimiento_revisado < now() - interval '7 days'),
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM seguimientos s WHERE s.proyecto_id = p.id))
        FROM proyectos_ley p WHERE periodo = (SELECT max(periodo) FROM proyectos_ley)""")
    p(f"Periodo actual: {act} proyectos; seguimiento nunca revisado: {nunca}; revisado hace mas de 7 dias: {viejo}; sin ningun movimiento guardado: {sin_mov}")
    [(leyes, sin_doc)] = q("SELECT count(*), count(*) FILTER (WHERE ley_docs->'ley' IS NULL) FROM proyectos_ley WHERE ley_numero IS NOT NULL")
    p(f"Convertidos en ley: {leyes}; sin la ley hallada en El Peruano: {sin_doc}")
    [(pub_sin,)] = q("SELECT count(*) FROM proyectos_ley WHERE estado ILIKE 'publicad%%' AND ley_numero IS NULL")
    p(f"Con estado 'Publicada' pero sin numero de ley: {pub_sin}")

    # ---------------------------------------------------------------- 3. monitoreo
    p("=== 3. MONITOREO EMPRESARIAL ===")
    meses = q("""SELECT to_char(n.fecha, 'YYYY-MM'), count(*), count(a.id), count(*) FILTER (WHERE a.relevante AND NOT a.excluido)
                 FROM normas n LEFT JOIN analisis a ON a.tipo = 'N' AND a.ref_id = n.id GROUP BY 1 ORDER BY 1""")
    completos = [m for m, t, r, _ in meses if r == t]
    parciales = [f"{m} ({r} de {t})" for m, t, r, _ in meses if 0 < r < t]
    nada = [m for m, t, r, _ in meses if r == 0]
    p(f"Meses con todas las normas revisadas: {len(completos)}" + (f" -> {muestra(completos, 40)}" if completos else ""))
    p(f"Meses a medio revisar: {len(parciales)}" + (f" -> {muestra(parciales, 40)}" if parciales else ""))
    p(f"Meses sin revisar: {len(nada)} (de {nada[0] if nada else '-'} a {nada[-1] if nada else '-'})")
    pmes = q("""SELECT to_char(fecha_presentacion, 'YYYY-MM'), count(*), count(a.id) FROM proyectos_ley p
                LEFT JOIN analisis a ON a.tipo = 'P' AND a.ref_id = p.id WHERE fecha_presentacion IS NOT NULL GROUP BY 1 ORDER BY 1""")
    p("Proyectos presentados por mes revisados por la IA: " + ", ".join(f"{m}: {r}/{t}" for m, t, r in pmes if r))
    [(rel, vacios_a, sin_punt, sin_com, sin_cal)] = q("""SELECT count(*), count(*) FILTER (WHERE coalesce(resumen, '') = ''),
        count(*) FILTER (WHERE puntaje IS NULL), count(*) FILTER (WHERE coalesce(cardinality(comites), 0) = 0),
        count(*) FILTER (WHERE coalesce(calificacion, '') = '') FROM analisis WHERE relevante""")
    p(f"Documentos en el reporte: {rel}; sin analisis escrito: {vacios_a}; sin puntaje: {sin_punt}; sin comites: {sin_com}; sin calificacion: {sin_cal}")
    crit = q("SELECT coalesce(criterio::text, 'sin version'), count(*) FROM analisis WHERE relevante GROUP BY 1 ORDER BY 1")
    p("Version de los criterios de los documentos del reporte: " + ", ".join(f"{a}: {b}" for a, b in crit))
    mod = q("SELECT coalesce(modelo, '-'), count(*) FROM analisis WHERE relevante GROUP BY 1 ORDER BY 2 DESC")
    p("Modelo de IA que hizo cada analisis del reporte: " + ", ".join(f"{a}: {b}" for a, b in mod))
    lect = q("SELECT coalesce(lectura, '-'), count(*) FROM analisis WHERE relevante GROUP BY 1 ORDER BY 2 DESC")
    p("Analisis hechos leyendo: " + ", ".join(f"{a}: {b}" for a, b in lect))
    [(huerfanos,)] = q("""SELECT count(*) FROM analisis a WHERE (a.tipo = 'N' AND NOT EXISTS (SELECT 1 FROM normas n WHERE n.id = a.ref_id))
                          OR (a.tipo = 'P' AND NOT EXISTS (SELECT 1 FROM proyectos_ley p WHERE p.id = a.ref_id))""")
    p(f"Analisis de documentos que ya no existen: {huerfanos}")

    # ---------------------------------------------------------------- 4. texto completo
    p("=== 4. TEXTO COMPLETO ===")
    normas_anio = q("SELECT hash_unico, extract(year FROM fecha)::int FROM normas WHERE url_detalle IS NOT NULL")
    proy = [r[0] for r in q("SELECT periodo || '|' || camara || '|' || numero FROM proyectos_ley WHERE num_pley IS NOT NULL")]
    c.close()
    estados_n, estados_p, claves_n, claves_p = {}, {}, set(), set()
    for numero, url in bases.bases_texto():
        try:
            t = psycopg2.connect(url, connect_timeout=60)
            tc = t.cursor()
            tc.execute("SELECT to_regclass('public.documentos') IS NOT NULL")
            if not tc.fetchone()[0]:
                t.close()
                continue
            tc.execute("SELECT tipo, estado, count(*) FROM documentos GROUP BY 1, 2")
            for tipo, est, n in tc.fetchall():
                d = estados_n if tipo == "N" else estados_p
                d[est] = d.get(est, 0) + n
            tc.execute("SELECT tipo, clave FROM documentos")
            for tipo, k in tc.fetchall():
                (claves_n if tipo == "N" else claves_p).add(k)
            t.close()
        except psycopg2.Error as e:
            p(f"Base de texto {numero}: no respondio ({type(e).__name__})")
    falta_n = {}
    for k, a in normas_anio:
        if k not in claves_n:
            falta_n[a] = falta_n.get(a, 0) + 1
    p(f"Normas: con texto {estados_n.get('ok', 0)}, escaneadas sin texto {estados_n.get('sin_texto', 0)}, "
      f"sin PDF {estados_n.get('sin_pdf', 0)}; sin procesar todavia: {sum(falta_n.values())} de {len(normas_anio)}"
      + (" -> por año: " + ", ".join(f"{a}: {n}" for a, n in sorted(falta_n.items())) if falta_n else ""))
    falta_p = sum(1 for k in proy if k not in claves_p)
    p(f"Proyectos: con texto {estados_p.get('ok', 0)}, escaneados sin texto {estados_p.get('sin_texto', 0)}, "
      f"sin PDF {estados_p.get('sin_pdf', 0)}; sin procesar todavia: {falta_p} de {len(proy)}")

    # ---------------------------------------------------------------- 5. resumenes
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    p("=== 5. RESUMENES DIARIOS ===")
    [(nr, pr, ur)] = q("SELECT count(*), min(fecha), max(fecha) FROM resumenes")
    p(f"Total: {nr}, del {pr} al {ur}")
    if pr:
        faltan = [r[0] for r in q("""SELECT d::date FROM generate_series(%s::date, %s::date, interval '1 day') d
                                     WHERE d::date NOT IN (SELECT fecha FROM resumenes) ORDER BY 1""", (pr, ayer))]
        p(f"Dias sin resumen desde el primero: {len(faltan)}" + (f" -> {muestra(faltan, 40)}" if faltan else ""))
    [(vac,)] = q("SELECT count(*) FROM resumenes WHERE coalesce(datos->>'panorama', '') = ''")
    p(f"Resumenes vacios: {vac}")
    desfase = q("""SELECT r.fecha, r.n_normas, count(n.id) FROM resumenes r LEFT JOIN normas n ON n.fecha = r.fecha
                   GROUP BY 1, 2 HAVING count(n.id) > r.n_normas ORDER BY 1""")
    p(f"Resumenes hechos antes de que llegaran todas las normas de su dia: {len(desfase)}"
      + (f" -> {muestra([f'{f} (resumio {a} de {b})' for f, a, b in desfase], 40)}" if desfase else ""))
    c.close()


def verificar_dias():
    """Vuelve a consultar El Peruano los dias vacios o con muy pocas normas y compara (solo lectura)."""
    import time
    import elperuano
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("""WITH d AS (SELECT fecha, count(*) n FROM normas GROUP BY 1),
                        m AS (SELECT extract(year FROM fecha) a, percentile_cont(0.5) WITHIN GROUP (ORDER BY n) med FROM d GROUP BY 1)
                   SELECT d.fecha, d.n FROM d JOIN m ON m.a = extract(year FROM d.fecha)
                   WHERE d.n < m.med * 0.2 AND extract(dow FROM d.fecha) BETWEEN 1 AND 5
                   UNION SELECT fecha, 0 FROM descargas WHERE estado = 'vacio' ORDER BY 1""")
    dias = cur.fetchall()
    c.close()
    iguales, distintos, fallas = 0, [], []
    for fecha, guardadas in dias:
        try:
            hoy_ep = len(elperuano.descargar_dia(fecha))
        except Exception as e:  # noqa: BLE001
            fallas.append(f"{fecha} ({type(e).__name__})")
            continue
        if hoy_ep == guardadas:
            iguales += 1
        else:
            distintos.append(f"{fecha}: sistema {guardadas}, El Peruano hoy {hoy_ep}")
        time.sleep(1)
    p(f"Dias revisados de nuevo en El Peruano: {len(dias)}; iguales a lo guardado: {iguales}; distintos: {len(distintos)}; sin respuesta: {len(fallas)}")
    for x in distintos:
        p("  " + x)
    if fallas:
        p("  Sin respuesta: " + ", ".join(fallas))


def detalle():
    """Detalle de las observaciones de la auditoria (solo lectura)."""
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("""SELECT fecha, tipo, numero, entidad, count(*) FROM normas WHERE coalesce(numero, '') <> ''
                   GROUP BY fecha, lower(tipo), tipo, numero, entidad HAVING count(*) > 1 ORDER BY 1 LIMIT 40""")
    p("Normas repetidas: " + "; ".join(f"{f} {t} {n} x{k}" for f, t, n, e, k in cur.fetchall()))
    cur.execute("""SELECT n1.fecha, n1.tipo, n1.numero, n1.url_detalle = n2.url_detalle, n1.sumilla = n2.sumilla
                   FROM normas n1 JOIN normas n2 ON n1.fecha = n2.fecha AND lower(n1.tipo) = lower(n2.tipo)
                    AND n1.numero = n2.numero AND n1.entidad = n2.entidad AND n1.id < n2.id
                   WHERE coalesce(n1.numero, '') <> '' LIMIT 40""")
    filas = cur.fetchall()
    p(f"De las repetidas: mismo enlace {sum(1 for x in filas if x[3])}, misma sumilla {sum(1 for x in filas if x[4])}, de {len(filas)}")
    cur.execute("SELECT id, fecha, entidad, left(sumilla, 80) FROM normas WHERE coalesce(tipo, '') = ''")
    p("Norma sin tipo: " + "; ".join(str(r) for r in cur.fetchall()))
    cur.execute("SELECT numero, estado, ley_numero FROM proyectos_ley WHERE estado ILIKE 'publicad%%' AND ley_numero IS NULL")
    p("Publicada sin numero de ley: " + "; ".join(str(r) for r in cur.fetchall()))
    cur.execute("""SELECT extract(year FROM ley_fecha)::int, count(*) FROM proyectos_ley WHERE ley_numero IS NOT NULL
                   AND ley_docs->'ley' IS NULL GROUP BY 1 ORDER BY 1""")
    p("Leyes no halladas en El Peruano, por año de publicacion: " + ", ".join(f"{a}: {n}" for a, n in cur.fetchall()))
    cur.execute("""SELECT ley_tipo, count(*) FROM proyectos_ley WHERE ley_numero IS NOT NULL AND ley_docs->'ley' IS NULL
                   GROUP BY 1 ORDER BY 2 DESC""")
    p("Leyes no halladas, por tipo: " + ", ".join(f"{a}: {n}" for a, n in cur.fetchall()))
    cur.execute("""SELECT p.ley_numero, p.ley_fecha, (SELECT count(*) FROM normas n WHERE n.numero = p.ley_numero) FROM proyectos_ley p
                   WHERE p.ley_numero IS NOT NULL AND p.ley_docs->'ley' IS NULL ORDER BY p.ley_fecha DESC NULLS LAST LIMIT 15""")
    p("Ejemplos (numero, fecha, normas con ese numero): " + "; ".join(str(r) for r in cur.fetchall()))
    cur.execute("SELECT a.tipo, a.ref_id, a.sector, a.modelo FROM analisis a WHERE a.relevante AND coalesce(cardinality(a.comites), 0) = 0")
    p("En el reporte sin comites: " + "; ".join(str(r) for r in cur.fetchall()))
    cur.execute("""SELECT rubro, sector, count(*) FROM normas WHERE rubro = 'Sin clasificar' OR sector = 'Otros'
                   GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 6""")
    p("Sin clasificar: " + "; ".join(str(r) for r in cur.fetchall()))
    c.close()


def leyes_faltantes():
    """Leyes que el Congreso da por publicadas y que no se hallan entre las normas: se buscan en El Peruano."""
    import elperuano
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("""SELECT DISTINCT ley_tipo, ley_numero, ley_fecha FROM proyectos_ley
                   WHERE ley_numero IS NOT NULL AND ley_docs->'ley' IS NULL ORDER BY ley_fecha""")
    faltan = cur.fetchall()
    p(f"Leyes y resoluciones legislativas distintas no halladas: {len(faltan)}")
    resumen = {"en_sistema_con_otro_numero": 0, "en_el_peruano_y_no_en_sistema": 0, "no_estan_en_el_peruano": 0, "sin_fecha": 0}
    ejemplos = {k: [] for k in resumen}
    cache = {}
    for tipo, num, fecha in faltan:
        cur.execute("""SELECT tipo, numero FROM normas WHERE (numero ILIKE %s OR tipo ILIKE %s)
                       AND entidad ILIKE 'CONGRESO%%' LIMIT 1""", (f"%{num}%", f"%{num}%"))
        otro = cur.fetchone()
        if otro:
            resumen["en_sistema_con_otro_numero"] += 1
            ejemplos["en_sistema_con_otro_numero"].append(f"{num} -> '{otro[0]}' '{otro[1]}'")
            continue
        if not fecha:
            resumen["sin_fecha"] += 1
            ejemplos["sin_fecha"].append(num)
            continue
        hallada = False
        for d in (fecha, fecha + timedelta(days=1), fecha - timedelta(days=1)):
            if d not in cache:
                try:
                    cache[d] = elperuano.descargar_dia(d)
                except Exception:  # noqa: BLE001
                    cache[d] = []
            for f in cache[d]:
                if num in f"{f['tipo']} {f['numero']}":
                    hallada = True
                    ejemplos["en_el_peruano_y_no_en_sistema"].append(f"{num} ({d}): {f['tipo']} {f['numero']}")
                    break
            if hallada:
                break
        resumen["en_el_peruano_y_no_en_sistema" if hallada else "no_estan_en_el_peruano"] += 1
        if not hallada:
            ejemplos["no_estan_en_el_peruano"].append(f"{tipo} {num} ({fecha})")
    for k, v in resumen.items():
        p(f"{k}: {v}" + (f" -> {'; '.join(ejemplos[k][:15])}" if ejemplos[k] else ""))
    c.close()


def casos():
    """Revision de dos casos de la auditoria: Ley 31632 y proposicion 02233/2021-CR (solo lectura)."""
    import elperuano
    import seguimiento
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("""SELECT id, periodo, camara, numero, num_pley, ley_tipo, ley_numero, ley_fecha, estado FROM proyectos_ley
                   WHERE ley_numero LIKE '%%31632%%' OR numero = '02233/2021-CR'""")
    for pid, per, cam, num, npl, lt, ln, lf, est in cur.fetchall():
        p(f"Proposicion {num} ({cam}, {per}): estado '{est}', ley {lt} {ln}, fecha {lf}")
        cur.execute("SELECT fecha::date, estado, left(detalle, 200) FROM seguimientos WHERE proyecto_id = %s AND estado ILIKE 'publicad%%'", (pid,))
        for f, e, d in cur.fetchall():
            p(f"  Paso de publicacion guardado: {f} | {e} | {d}")
        exp = seguimiento.expediente(per, cam, npl) or {}
        for x in exp.get("seguimientos") or []:
            if "publicad" in str(x.get("desEstado", "")).lower():
                p(f"  En el Congreso hoy: {str(x.get('fecha'))[:10]} | {x.get('desEstado')} | {str(x.get('detalle') or x.get('observacion') or '')[:200]}")
    cur.execute("""SELECT fecha, tipo, numero, entidad, left(sumilla, 120) FROM normas
                   WHERE numero ILIKE '%%31632%%' OR tipo ILIKE '%%31632%%' OR sumilla ILIKE '%%31632%%' ORDER BY fecha LIMIT 10""")
    p("Normas del sistema que mencionan 31632: " + ("; ".join(str(r) for r in cur.fetchall()) or "ninguna"))
    cur.execute("SELECT ley_fecha FROM proyectos_ley WHERE ley_numero LIKE '%%31632%%' AND ley_fecha IS NOT NULL LIMIT 1")
    f = cur.fetchone()
    if f:
        hallados = []
        for k in range(-10, 11):
            d = f[0] + timedelta(days=k)
            try:
                for x in elperuano.descargar_dia(d):
                    if "31632" in f"{x['tipo']} {x['numero']} {x['sumilla']}":
                        hallados.append(f"{d}: {x['tipo']} {x['numero']} | {x['entidad']}")
            except Exception as e:  # noqa: BLE001
                hallados.append(f"{d}: sin respuesta ({type(e).__name__})")
        p("El Peruano, 10 dias antes y despues: " + ("; ".join(hallados) or "no aparece la Ley 31632"))
    c.close()


def clasificacion():
    """De donde vienen las normas sin rubro o sin sector reconocido (solo lectura)."""
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("SELECT count(*), count(*) FILTER (WHERE sector = 'Otros'), count(*) FILTER (WHERE rubro = 'Sin clasificar') FROM normas")
    t, so, rs = cur.fetchone()
    p(f"Normas: {t}; sector 'Otros': {so}; rubro 'Sin clasificar': {rs}")
    cur.execute("""SELECT upper(entidad), count(*) FROM normas WHERE sector = 'Otros' GROUP BY 1 ORDER BY 2 DESC LIMIT 45""")
    p("Entidades con sector 'Otros' (las 45 con mas normas): " + "; ".join(f"{e} {n}" for e, n in cur.fetchall()))
    cur.execute("""SELECT count(DISTINCT upper(entidad)) FROM normas WHERE sector = 'Otros'""")
    p(f"Entidades distintas con sector 'Otros': {cur.fetchone()[0]}")
    cur.execute("""SELECT sector, count(*) FROM normas WHERE rubro = 'Sin clasificar' GROUP BY 1 ORDER BY 2 DESC LIMIT 12""")
    p("Rubro 'Sin clasificar' por sector: " + "; ".join(f"{a} {b}" for a, b in cur.fetchall()))
    cur.execute("""SELECT tipo, count(*) FROM normas WHERE rubro = 'Sin clasificar' GROUP BY 1 ORDER BY 2 DESC LIMIT 15""")
    p("Rubro 'Sin clasificar' por tipo: " + "; ".join(f"{a} {b}" for a, b in cur.fetchall()))
    cur.execute("""SELECT left(sumilla, 110) FROM normas WHERE rubro = 'Sin clasificar' AND sector NOT IN ('Gobiernos Locales', 'Gobiernos Regionales')
                   ORDER BY random() LIMIT 25""")
    p("Muestra de sumillas sin rubro: " + " || ".join(r[0] for r in cur.fetchall()))
    c.close()


def depurar_leyes():
    """Por que no se enlazan algunas leyes (solo lectura)."""
    import leyes
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("""SELECT count(*) FROM normas WHERE translate(lower(tipo), 'áéíóú', 'aeiou')
                   ~ '^\\W*(fe de erratas?\\s+(de\\s+(la\\s+)?)?)?(ley(es)?|resolucion(es)? legislativas?)\\y'""")
    p(f"Normas que la consulta reconoce como leyes o resoluciones legislativas: {cur.fetchone()[0]}")
    for n in ("32513", "011-2025-2026", "003-2021-2022", "019-2021-2022"):
        cur.execute("SELECT fecha, tipo, numero, entidad FROM normas WHERE numero ILIKE %s OR tipo ILIKE %s LIMIT 5", (f"%{n}%", f"%{n}%"))
        filas = cur.fetchall()
        p(f"{n}: " + ("; ".join(f"{f} | {t} | {u} | {e} -> {leyes.claves_norma(t, u)}" for f, t, u, e in filas) or "no hay normas con ese numero"))
    cur.execute("""SELECT ley_tipo, ley_numero, ley_docs IS NULL FROM proyectos_ley WHERE ley_numero IS NOT NULL AND ley_docs->'ley' IS NULL LIMIT 8""")
    p("Proyectos sin enlace: " + "; ".join(f"{t} {n} -> {leyes.clave_proyecto(t, n)}" for t, n, _ in cur.fetchall()))
    cur.execute("SELECT tipo, count(*) FROM normas WHERE entidad ILIKE 'CONGRESO%%' GROUP BY 1 ORDER BY 2 DESC LIMIT 12")
    p("Tipos de norma del Congreso: " + "; ".join(f"{t} {n}" for t, n in cur.fetchall()))
    c.close()


def clasificacion_datos():
    """Lista completa de entidades sin sector y frases frecuentes sin rubro (solo lectura)."""
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("SELECT upper(entidad), count(*) FROM normas WHERE sector = 'Otros' GROUP BY 1 ORDER BY 2 DESC")
    p("ENTIDADES: " + " | ".join(f"{e}={n}" for e, n in cur.fetchall()))
    cur.execute("""SELECT lower(split_part(sumilla, ' ', 1) || ' ' || split_part(sumilla, ' ', 2) || ' ' || split_part(sumilla, ' ', 3)) f,
                          count(*) FROM normas WHERE rubro = 'Sin clasificar' GROUP BY 1 ORDER BY 2 DESC LIMIT 120""")
    p("FRASES: " + " | ".join(f"{f}={n}" for f, n in cur.fetchall()))
    c.close()


def muestra_ia():
    """Muestra al azar de normas clasificadas por la IA, para revisar si el rubro es correcto (solo lectura)."""
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("""SELECT rubro, count(*) FROM normas WHERE rubro_ia GROUP BY 1 ORDER BY 2 DESC""")
    p("RUBROS IA: " + " | ".join(f"{r}={n}" for r, n in cur.fetchall()))
    cur.execute("""SELECT rubro, entidad, left(sumilla, 160) FROM normas WHERE rubro_ia AND rubro <> 'Sin clasificar'
                   ORDER BY random() LIMIT 60""")
    for r, e, s_ in cur.fetchall():
        p(f"[{r}] {e}: {s_}")


def uso_ia_detalle():
    """Consultas a la IA de los ultimos 3 dias por tarea, modelo y resultado (solo lectura)."""
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("""SELECT to_char(creado_en AT TIME ZONE 'America/Lima', 'MM-DD HH24'), coalesce(origen, '?'), modelo,
                          resultado, coalesce(http, 0), count(*)
                   FROM uso_ia WHERE creado_en > now() - interval '3 days' GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3""")
    for f in cur.fetchall():
        p("USO " + " | ".join(str(x) for x in f))


def auditoria_sectores():
    """Cada entidad emisora con el sector guardado y el que dan las reglas actuales (solo lectura)."""
    import classifier
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("SELECT entidad, sector, count(*) FROM normas GROUP BY 1, 2 ORDER BY 3 DESC")
    filas = cur.fetchall()
    cambian = [(e, s_, classifier.clasificar_sector(e), n) for e, s_, n in filas if classifier.clasificar_sector(e) != s_]
    p(f"ENTIDADES: {len(filas)}; cambian de sector: {len(cambian)} ({sum(x[3] for x in cambian)} normas)")
    for e, viejo, nuevo, n in cambian:
        p(f"CAMBIA {n} | {viejo} -> {nuevo} | {e}")
    for e, s_, n in filas:
        p(f"ENT {n} | {classifier.clasificar_sector(e)} | {e}")


def textos_muestra():
    """Texto guardado de algunas normas (por su codigo de El Peruano), para ver si trae otras normas (solo lectura)."""
    import re as _re
    from monitoreo import textos
    codigos = (os.getenv("CODIGOS") or "2571897-1,2570668-1,2572828-1,2572850-1").split(",")
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("SELECT hash_unico, tipo, numero, url_detalle FROM normas WHERE url_detalle LIKE ANY(%s)",
                ([f"%/{x.strip()}" for x in codigos],))
    filas = cur.fetchall()
    t = textos("N", [f[0] for f in filas])
    for h, tipo, num, url in filas:
        x = t.get(h, "")
        finales = _re.findall(r"\b\d{6,8}-\d\b", x)
        p(f"TXT {tipo} {num} | {url.rsplit('/', 1)[-1]} | {len(x)} caracteres | codigos de fin de norma en el texto: {finales[:12]}")
        p("TXT   INICIO: " + x[:500].replace("\n", " "))
        p("TXT   FIN: " + x[-300:].replace("\n", " "))


def muestra_ia_proyectos():
    """Muestra al azar de proyectos de ley clasificados por la IA (solo lectura)."""
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("SELECT rubro, count(*) FROM proyectos_ley GROUP BY 1 ORDER BY 2 DESC")
    p("RUBROS PROYECTOS: " + " | ".join(f"{r}={n}" for r, n in cur.fetchall()))
    cur.execute("""SELECT rubro, left(titulo, 170) FROM proyectos_ley WHERE rubro_ia AND rubro <> 'Sin clasificar'
                   ORDER BY random() LIMIT 60""")
    for r, t in cur.fetchall():
        p(f"[{r}] {t}")


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else "neon"
    {"neon": neon, "consultas": consultas, "conteos": conteos, "seguridad": seguridad, "web": web, "ia": ia, "auditoria": auditoria,
     "verificar_dias": verificar_dias, "detalle": detalle,
     "leyes_faltantes": leyes_faltantes, "casos": casos,
     "clasificacion": clasificacion, "depurar_leyes": depurar_leyes,
     "clasificacion_datos": clasificacion_datos, "muestra_ia": muestra_ia, "uso_ia_detalle": uso_ia_detalle, "auditoria_sectores": auditoria_sectores, "textos_muestra": textos_muestra, "muestra_ia_proyectos": muestra_ia_proyectos}[modo]()
    print("\n".join(lineas))
    # El resultado va en avisos de la ejecucion (GitHub muestra hasta 10 por paso): se reparte en partes
    partes, actual = [], ""
    for linea in lineas:
        if actual and len(actual) + len(linea) > 3500:
            partes.append(actual)
            actual = ""
        actual += linea + "\n"
    if actual:
        partes.append(actual)
    for i, parte in enumerate(partes[:10], 1):
        cod = parte.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
        print(f"::notice title=Diagnostico {modo} ({i}/{len(partes)})::{cod}")


if __name__ == "__main__":
    main()
