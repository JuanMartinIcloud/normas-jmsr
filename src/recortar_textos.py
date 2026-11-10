"""Corrige el texto completo ya guardado de las normas: deja solo la norma, sin el final de la anterior ni el
inicio de la siguiente que traen las paginas de El Peruano (ver textos.recortar_norma).

    python src/recortar_textos.py simular   # no escribe nada: cuenta y muestra ejemplos (lee una muestra)
    python src/recortar_textos.py aplicar   # escribe los textos corregidos, base por base

Nunca se pierde texto de la norma: si el recorte no se puede verificar (su numero no aparece en el tramo),
el texto queda como estaba. Al aplicar, cada 2.000 cambios se libera el espacio (VACUUM) para no pasar el
limite de espacio de cada base.
"""
import random
import sys
import time
from collections import Counter

import psycopg2
from psycopg2.extras import execute_values

import bases
from textos import codigo_norma, recortar_norma

LOTE_LECTURA = 300
LIBERAR_CADA = 2000


def datos_normas():
    c = psycopg2.connect(bases.url_principal(), connect_timeout=60)
    cur = c.cursor()
    cur.execute("SELECT hash_unico, url_detalle, coalesce(numero, '') FROM normas WHERE url_detalle IS NOT NULL")
    salida = {h: (codigo_norma(u), n) for h, u, n in cur.fetchall()}
    c.close()
    return salida


def liberar(url):
    c = psycopg2.connect(url, connect_timeout=60)
    c.autocommit = True
    c.cursor().execute("VACUUM documentos")
    c.close()


def main():
    modo = (sys.argv[1] if len(sys.argv) > 1 else "simular").strip()
    aplicar = modo == "aplicar"
    normas = datos_normas()
    print(f"Normas en la base principal: {len(normas)}")
    total = Counter()
    ejemplos = []
    dudosos = []
    for num, url in bases.bases_texto():
        inicio = time.time()
        c = psycopg2.connect(url, connect_timeout=60)
        cur = c.cursor()
        cur.execute("SELECT to_regclass('documentos') IS NOT NULL")
        if not cur.fetchone()[0]:
            c.close()
            continue
        cur.execute("SELECT pg_total_relation_size('documentos')")
        tam_antes = cur.fetchone()[0]
        cuenta = Counter()
        ultima = ""
        pendientes = []
        cambiados_desde_vacuum = 0
        while True:
            if aplicar:
                cur.execute("""SELECT clave, texto FROM documentos WHERE tipo = 'N' AND estado = 'ok' AND clave > %s
                               ORDER BY clave LIMIT %s""", (ultima, LOTE_LECTURA))
            else:
                # Simulacion: una muestra de cada base (no se lee todo, para no gastar transferencia)
                cur.execute("""SELECT clave, texto FROM documentos TABLESAMPLE SYSTEM (1)
                               WHERE tipo = 'N' AND estado = 'ok' LIMIT 400""")
            filas = cur.fetchall()
            if not filas:
                break
            for clave, texto in filas:
                codigo, numero = normas.get(clave, (None, ""))
                nuevo, como = recortar_norma(texto, codigo, numero)
                cuenta[como] += 1
                if como in ("no_verificado", "inicio", "aviso") and len(dudosos) < 40:
                    dudosos.append((num, clave, codigo, numero, como, texto))
                if nuevo != texto:
                    cuenta["caracteres_quitados"] += len(texto) - len(nuevo)
                    pendientes.append((clave, nuevo))
                    if len(ejemplos) < 400:
                        ejemplos.append((num, clave, codigo, numero, como, texto, nuevo))
            ultima = filas[-1][0]
            if aplicar and pendientes:
                # Texto vacio = era un aviso de El Peruano, no la norma: queda como «sin texto» para que la
                # tarea de documentos pendientes lo vuelva a buscar
                execute_values(cur, """UPDATE documentos d SET texto = v.t,
                                         estado = CASE WHEN v.t = '' THEN 'sin_texto' ELSE d.estado END
                                       FROM (VALUES %s) AS v(k, t)
                                       WHERE d.tipo = 'N' AND d.clave = v.k""", pendientes)
                c.commit()
                cambiados_desde_vacuum += len(pendientes)
                pendientes = []
                if cambiados_desde_vacuum >= LIBERAR_CADA:
                    liberar(url)
                    cambiados_desde_vacuum = 0
            if not aplicar:
                break
        c.commit()
        if aplicar and cambiados_desde_vacuum:
            liberar(url)
        cur.execute("SELECT pg_total_relation_size('documentos')")
        tam_despues = cur.fetchone()[0]
        c.close()
        total.update(cuenta)
        print(f"Base {num}: {dict(cuenta)}; espacio {tam_antes / 1e6:.0f} MB -> {tam_despues / 1e6:.0f} MB "
              f"({time.time() - inicio:.0f} s)")
    print(f"TOTAL {'APLICADO' if aplicar else 'SIMULACION (muestra)'}: {dict(total)}")
    for num, clave, codigo, numero, como, texto in dudosos:
        import re as _re
        print(f"=== DUDOSO base {num} | numero {numero!r} | codigo {codigo} | {como} | {len(texto)} caracteres | "
              f"codigos en el texto: {_re.findall(r'(?<![\d-])\d{6,8}-\d{1,2}(?![\d-])', texto)[:8]}")
        print("    INICIO: " + texto[:300].replace("\n", " "))
        if como == "inicio":
            nuevo, _ = recortar_norma(texto, codigo, numero)
            print("    QUEDA: " + nuevo[:300].replace("\n", " "))
    random.seed(1)
    for num, clave, codigo, numero, como, texto, nuevo in random.sample(ejemplos, min(25, len(ejemplos))):
        print(f"--- base {num} | {numero} | codigo {codigo} | {como} | {len(texto)} -> {len(nuevo)} caracteres")
        print("    QUITADO AL INICIO: " + texto[:max(0, texto.find(nuevo[:40]))][-250:].replace("\n", " ") if nuevo[:40] in texto else "    (inicio reescrito)")
        print("    NUEVO INICIO: " + nuevo[:250].replace("\n", " "))
        print("    NUEVO FIN: " + nuevo[-150:].replace("\n", " "))


if __name__ == "__main__":
    main()
