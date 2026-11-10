"""Diccionario de palabras para corregir errores de escritura en las busquedas (se actualiza cada lunes).

Reune todas las palabras de las sumillas de las normas y de los titulos y sumillas de los proyectos
(tabla "vocabulario" de la base principal). La web lo usa cuando una busqueda no da resultados:
si una palabra esta mal escrita (por ejemplo "piscologica"), busca la mas parecida que si existe
("psicológica") y repite la busqueda con ella.
"""
import os

import psycopg2

import neon_urls

neon_urls.completar_entorno()

import cupos

SIN_TILDE = "translate(word, 'áéíóúüàèìòù', 'aeiouuaeiou')"

SQL_TABLA = """
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS vocabulario (
    sin_tilde TEXT PRIMARY KEY,   -- palabra en minusculas y sin tildes (lo que se compara)
    palabra   TEXT NOT NULL,      -- forma mas usada, con tildes (lo que se muestra y se busca)
    n         INTEGER NOT NULL    -- en cuantos documentos aparece
);
CREATE INDEX IF NOT EXISTS vocabulario_trgm ON vocabulario USING gin (sin_tilde gin_trgm_ops);
"""


def main():
    if cupos.principal_en_emergencia():
        return
    c = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=60)
    cur = c.cursor()
    cur.execute(SQL_TABLA)
    cur.execute(
        """CREATE TEMP TABLE v AS
           SELECT word, sum(ndoc)::int AS n FROM (
             SELECT word, ndoc FROM ts_stat($q$SELECT to_tsvector('simple', coalesce(sumilla, '')) FROM normas$q$)
             UNION ALL
             SELECT word, ndoc FROM ts_stat($q$SELECT to_tsvector('simple', coalesce(titulo, '') || ' ' ||
                                                  coalesce(sumilla, '')) FROM proyectos_ley$q$)
           ) x
           WHERE length(word) >= 4 AND word !~ '[0-9_]'
           GROUP BY word"""
    )
    cur.execute(
        f"""INSERT INTO vocabulario (sin_tilde, palabra, n)
            SELECT s, palabra, total FROM (
              SELECT {SIN_TILDE} AS s, word AS palabra,
                     sum(n) OVER (PARTITION BY {SIN_TILDE}) AS total,
                     row_number() OVER (PARTITION BY {SIN_TILDE} ORDER BY n DESC) AS orden
              FROM v) y
            WHERE orden = 1
            ON CONFLICT (sin_tilde) DO UPDATE SET palabra = excluded.palabra, n = excluded.n
            -- solo se reescriben las palabras que cambiaron (no las ~100 mil cada semana)
            WHERE (vocabulario.palabra, vocabulario.n) IS DISTINCT FROM (excluded.palabra, excluded.n)"""
    )
    c.commit()
    cur.execute("SELECT count(*) FROM vocabulario")
    print(f"Vocabulario: {cur.fetchone()[0]} palabras")
    c.close()


if __name__ == "__main__":
    main()
