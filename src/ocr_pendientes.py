"""Vuelve a leer los documentos guardados SIN TEXTO (PDF escaneados): primero busca en el expediente
otro PDF que si traiga texto y, si no hay, lee el escaneado con OCR (Tesseract, gratuito).

    python src/ocr_pendientes.py --max-minutos 45
    python src/ocr_pendientes.py --contar          # cuantos faltan (para decidir si se corre)

- Cada documento revisado queda anotado en la tabla "ocr_revisado" de la base de control:
  no se repite aunque el OCR no encuentre texto.
- El texto nuevo se guarda en una base de texto con espacio y se borra el registro viejo de su base
  (primero se guarda, despues se borra: nunca se pierde nada).
- Las escrituras se juntan y se envian cada 20 minutos, como en indexar.py.
"""
import argparse
import time
import zlib

import requests
from psycopg2.extras import execute_values

import cupos
import indexar
from textos import codigo_norma, es_aviso_sin_texto, recortar_norma
from indexar import Bases, FuenteNoResponde, extraer, expediente_proyecto, pdf_norma, texto_cuadernillo, texto_html_norma, texto_ley_congreso

SQL_CONTROL = """CREATE TABLE IF NOT EXISTS ocr_revisado (
    tipo  CHAR(1) NOT NULL,
    clave TEXT    NOT NULL,
    resultado TEXT NOT NULL,
    revisado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tipo, clave))"""


def revisados(bases) -> set:
    # Normas: revision con la pagina y la edicion completa de El Peruano, marcada "n5_..."
    def f(cur):
        cur.execute(SQL_CONTROL)
        cur.execute("SELECT tipo, clave FROM ocr_revisado WHERE tipo = 'P' OR resultado LIKE 'n5%'")
        return {(t, k) for t, k in cur.fetchall()}
    return bases.ejecutar(bases.control, f)


def sin_texto(bases):
    """{(tipo, clave): url_de_su_base} de los documentos guardados sin texto."""
    salida = {}
    for url in bases.urls:
        def f(cur):
            cur.execute("""SELECT tipo, clave FROM documentos
                           WHERE (tipo = 'P' AND estado = 'sin_texto') OR (tipo = 'N' AND estado IN ('sin_texto', 'sin_pdf'))""")
            return cur.fetchall()
        for t, k in bases.ejecutar(url, f):
            salida[(t, k)] = url
    return salida


def pendientes(bases):
    ya = revisados(bases)
    return {k: u for k, u in sin_texto(bases).items() if k not in ya}


class Envio:
    def __init__(self, bases):
        self.bases = bases
        self.nuevos = []      # (tipo, clave, estado, texto, url_origen)
        self.marcas = []      # (tipo, clave, resultado)
        self.bloque = int(time.time() // indexar.BLOQUE_SEGUNDOS)

    def agregar(self, tipo, clave, texto, origen, resultado):
        if texto is not None:
            texto = texto.replace("\x00", "").encode("utf-8", "ignore").decode("utf-8")
            self.nuevos.append((tipo, clave, "ok", texto, origen))
        self.marcas.append((tipo, clave, resultado))
        bloque = int(time.time() // indexar.BLOQUE_SEGUNDOS)
        if bloque != self.bloque or len(self.nuevos) >= 100:
            self.enviar()
            self.bloque = bloque

    def enviar(self):
        b = self.bases
        if self.nuevos:
            destino = b.destino()
            filas = [(t, k, e, x) for t, k, e, x, _ in self.nuevos]

            def guardar(cur):
                execute_values(cur, """INSERT INTO documentos (tipo, clave, estado, texto) VALUES %s
                                       ON CONFLICT (tipo, clave) DO UPDATE
                                       SET estado = EXCLUDED.estado, texto = EXCLUDED.texto, creado_en = now()""",
                               filas, page_size=20)
            b.ejecutar(destino, guardar)
            # El registro viejo (sin texto) se borra de su base, si estaba en otra
            por_base = {}
            for t, k, _, _, origen in self.nuevos:
                if origen != destino:
                    por_base.setdefault(origen, []).append((t, k))
            for origen, claves in por_base.items():
                def borrar(cur, claves=claves):
                    for t, k in claves:
                        cur.execute("DELETE FROM documentos WHERE tipo = %s AND clave = %s AND estado IN ('sin_texto', 'sin_pdf')", (t, k))
                b.ejecutar(origen, borrar)
            print(f"  guardados {len(self.nuevos)} textos nuevos")
            self.nuevos = []
        if self.marcas:
            marcas = self.marcas

            def marcar(cur):
                cur.execute(SQL_CONTROL)
                execute_values(cur, """INSERT INTO ocr_revisado (tipo, clave, resultado) VALUES %s
                                       ON CONFLICT (tipo, clave) DO UPDATE SET resultado = EXCLUDED.resultado,
                                       revisado_en = now()""", marcas)
            b.ejecutar(b.control, marcar)
            self.marcas = []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parte", type=int, default=0)
    ap.add_argument("--de", type=int, default=1)
    ap.add_argument("--max-minutos", type=float, default=50)
    ap.add_argument("--contar", action="store_true")
    a = ap.parse_args()
    fin = time.time() + a.max_minutos * 60

    if cupos.principal_agotada():
        if a.contar:
            print(0)   # no relanzar hasta que se renueve el cupo
        return
    bases = Bases()
    pend = pendientes(bases)
    if a.contar:
        print(len(pend))
        return
    if not pend:
        print("No hay documentos pendientes.")
        return
    # Datos de la base principal: solo los documentos pendientes (para no gastar su trafico mensual)
    c = indexar.principal()
    cur = c.cursor()
    claves_p = [k for t, k in pend if t == "P"]
    cur.execute("""SELECT periodo || '|' || camara || '|' || numero, periodo, camara, num_pley, coalesce(titulo, '')
                   FROM proyectos_ley WHERE periodo || '|' || camara || '|' || numero = ANY(%s)""", (claves_p,))
    proyectos = {r[0]: r[1:] for r in cur.fetchall()}
    claves_n = [k for t, k in pend if t == "N"]
    cur.execute("SELECT hash_unico, fecha, url_detalle, numero, tipo FROM normas WHERE hash_unico = ANY(%s)", (claves_n,))
    normas = {r[0]: r[1:] for r in cur.fetchall()}
    c.close()

    # Reparto en tramos seguidos, ordenados por fecha (las normas de un mismo dia comparten la
    # edicion completa, que asi se descarga una sola vez); en cada tanda lo que falta se divide parejo
    def orden(k):
        f = normas.get(k[1], (None,))[0] if k[0] == "N" else None
        return (k[0], str(f or ""), zlib.crc32(k[1].encode()))
    todos = sorted(pend, key=orden)
    tramo = -(-len(todos) // a.de)
    mias = todos[a.parte * tramo:(a.parte + 1) * tramo]
    print(f"Documentos sin texto pendientes: {len(pend)}; de este trabajador: {len(mias)}")
    if not mias:
        return

    envio = Envio(bases)
    hechos = con_texto = errores = 0
    espera = 30
    try:
        for tipo, clave in mias:
            if time.time() > fin - 240:   # deja tiempo para enviar lo pendiente
                break
            origen = pend[(tipo, clave)]
            inicio = time.time()
            try:
                if tipo == "P":
                    if clave not in proyectos:
                        envio.agregar(tipo, clave, None, origen, "no_esta")
                        continue
                    periodo, camara, num_pley, titulo = proyectos[clave]
                    sumilla, texto, _ = expediente_proyecto(periodo, camara, num_pley)
                    cabecera = "\n".join(x for x in (titulo, sumilla) if x)
                    completo = f"{cabecera}\n\n{texto}".strip()
                else:
                    if clave not in normas:
                        envio.agregar(tipo, clave, None, origen, "n5_no_esta")
                        continue
                    fecha, url, numero, tipo_norma = normas[clave]
                    datos = pdf_norma(url, fecha)
                    texto = extraer(datos) if datos else ""
                    if es_aviso_sin_texto(texto):
                        texto = ""   # El Peruano entrego un aviso en lugar de la norma
                    # Sin PDF o PDF vacio/dañado: pagina de la norma, su otro PDF y, al final,
                    # las paginas de la edicion completa del dia donde aparece su numero
                    for otra in (lambda: texto_html_norma(url), lambda: texto_ley_congreso(tipo_norma, numero),
                                 lambda: texto_cuadernillo(fecha, numero, tipo_norma)):
                        if len(texto) >= 100:
                            break
                        alterno = otra()
                        if len(alterno) > len(texto):
                            texto = alterno
                    texto, _ = recortar_norma(texto, codigo_norma(url), numero)   # solo la norma
                    completo = texto
                errores, espera = 0, 30
            except (requests.RequestException, FuenteNoResponde, ValueError) as e:
                errores += 1
                print(f"  {tipo} {clave}: {e}; espero {espera} s")
                if errores >= indexar.MAX_ERRORES_SEGUIDOS:
                    print("  La fuente no responde; se continuara en la proxima ejecucion.")
                    break
                time.sleep(espera)
                espera = min(espera * 2, 600)
                continue
            pre = "n5_" if tipo == "N" else ""
            if len(texto) >= 100:
                envio.agregar(tipo, clave, completo, origen, pre + "ok")
                con_texto += 1
            else:
                envio.agregar(tipo, clave, None, origen, pre + "sin_texto")
            hechos += 1
            print(f"  {tipo} {clave}: {len(texto)} caracteres ({time.time() - inicio:.0f} s)")
            time.sleep(1)
    finally:
        envio.enviar()
    print(f"Revisados: {hechos}; ahora con texto: {con_texto}")


if __name__ == "__main__":
    main()
