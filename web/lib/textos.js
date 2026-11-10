import { neon } from "@neondatabase/serverless";
import { basesTexto } from "./bases";
import { unstable_cache, unstable_noStore as sinCache } from "next/cache";

// Busqueda en el TEXTO COMPLETO de normas y proyectos.
// El texto esta en las bases de texto (ver lib/bases.js), tabla "documentos".
// Cada documento se identifica con una clave estable:
//   normas    -> hash_unico
//   proyectos -> "periodo|camara|numero"

const MAX_CLAVES = 5000;   // por base y por busqueda

export function claveProyecto(p) {
  return `${p.periodo}|${p.camara}|${p.numero}`;
}

async function bases() {
  return basesTexto();
}

function enBase(url, texto, params) {
  sinCache();
  const sql = neon(url, { fetchOptions: { cache: "no-store" } });
  if (typeof sql.query === "function") return sql.query(texto, params);
  return sql(texto, params);
}

// Igual que enBase, pero la base corta la consulta si pasa de "ms" milisegundos
// (asi una base lenta no deja la pagina esperando)
async function enBaseLimitada(url, texto, params, ms) {
  sinCache();
  const sql = neon(url, { fetchOptions: { cache: "no-store" } });
  const consulta = typeof sql.query === "function" ? sql.query(texto, params) : sql(texto, params);
  const [, filas] = await sql.transaction([sql(`SET LOCAL statement_timeout = ${Math.round(ms)}`), consulta], {
    readOnly: true,
  });
  return filas;
}

// La misma busqueda en una base de texto no se repite durante 30 minutos (los textos nuevos se
// agregan una vez al dia). Un error o un tiempo agotado no se guarda: se vuelve a intentar.
// (la clave del resultado guardado lleva el numero de la base, nunca su cadena de conexion)
const enBaseGuardada = unstable_cache(
  async (numero, texto, params, ms) => {
    const b = basesTexto().find((x) => x.numero === numero);
    if (!b) return [];
    return enBaseLimitada(b.url, texto, params, ms);
  },
  ["texto-completo-v1"],
  { revalidate: 1800, tags: ["datos"] }
);

function excedioTiempo(e) {
  return /57014|statement timeout|canceling statement/i.test(`${e && e.code} ${e && e.message}`);
}

// Consulta de busqueda: admite "frase exacta" entre comillas, OR y -palabra (como Google).
// Varios terminos se combinan con O: basta que el documento contenga uno.
function consultaTs(terminos, primerParametro) {
  return terminos.map((_, i) => `websearch_to_tsquery('spanish', $${primerParametro + i})`).join(" || ");
}

function tablaFaltante(e) {
  return /relation .*documentos.* does not exist|42P01/i.test(`${e && e.code} ${e && e.message}`);
}

// Ejecuta la consulta en todas las bases de texto, con un tiempo maximo por base.
// Si una no tiene la tabla aun, la omite; si tarda demasiado, la omite y marca el resultado
// como "parcial" (la pagina avisa que puede estar incompleto).
const LIMITE_MS = 6000;

async function enTodas(sql, params, ms = LIMITE_MS) {
  let parcial = false;
  const respuestas = await Promise.all(
    (await bases()).map((b) =>
      enBaseGuardada(b.numero, sql, params, ms).catch((e) => {
        if (tablaFaltante(e)) return [];
        if (excedioTiempo(e)) {
          parcial = true;
          return [];
        }
        throw e;
      })
    )
  );
  const filas = respuestas.flat();
  filas.parcial = parcial;
  return filas;
}

// Claves de los documentos cuyo texto completo contiene lo buscado
export async function clavesPorTexto(tipo, terminos) {
  const lista = (terminos || []).filter(Boolean);
  if (!lista.length || !(await bases()).length) return [];
  const filas = await enTodas(
    `SELECT clave FROM documentos
     WHERE tipo = $1 AND to_tsvector('spanish', texto) @@ (${consultaTs(lista, 2)})
     LIMIT ${MAX_CLAVES}`,
    [tipo, ...lista]
  );
  const claves = filas.map((r) => r.clave);
  claves.parcial = filas.parcial;
  return claves;
}

// Claves de los documentos cuyo texto completo cumple TODOS los grupos a la vez
// (dentro de cada grupo basta uno de sus terminos). Sirve para los filtros sucesivos.
export async function clavesPorGrupos(tipo, grupos) {
  const validos = (grupos || []).map((g) => (g || []).filter(Boolean)).filter((g) => g.length);
  if (!validos.length || !(await bases()).length) return [];
  const params = [tipo];
  const partes = validos.map(
    (g) =>
      "(" +
      g
        .map((t) => {
          params.push(t);
          return `websearch_to_tsquery('spanish', $${params.length})`;
        })
        .join(" || ") +
      ")"
  );
  const filas = await enTodas(
    `SELECT clave FROM documentos
     WHERE tipo = $1 AND to_tsvector('spanish', texto) @@ (${partes.join(" && ")})
     LIMIT ${MAX_CLAVES}`,
    params
  );
  const claves = filas.map((r) => r.clave);
  claves.parcial = filas.parcial;
  return claves;
}

// Pasajes del texto donde aparece lo buscado: { clave: "…texto con [[palabra]]…" }
export async function fragmentos(tipo, claves, terminos) {
  const lista = (terminos || []).filter(Boolean);
  const salida = {};
  const ks = (claves || []).filter(Boolean);
  if (!lista.length || !ks.length || !(await bases()).length) return salida;
  const filas = await enTodas(
    `SELECT clave,
            ts_headline('spanish', left(texto, 25000), (${consultaTs(lista, 3)}),
              'MaxFragments=1, MaxWords=35, MinWords=15, ShortWord=3, StartSel=[[, StopSel=]]') AS frag
     FROM documentos WHERE tipo = $1 AND clave = ANY($2::text[]) AND texto <> ''`,
    [tipo, ks, ...lista],
    6000
  );
  for (const r of filas) if (r.frag && /\[\[/.test(r.frag)) salida[r.clave] = r.frag;
  return salida;
}

// Texto completo guardado de un documento (o "" si no esta o es escaneado sin texto)
export async function textoCompleto(tipo, clave) {
  if (!clave || !(await bases()).length) return "";
  const filas = await enTodas(`SELECT estado, texto FROM documentos WHERE tipo = $1 AND clave = $2`, [tipo, clave]);
  const ok = filas.find((f) => f.estado === "ok" && f.texto);
  return ok ? ok.texto : "";
}

// Estado de cada base de texto y del avance (para /api/estado)
export async function estadoBases() {
  const salida = { bases: [], avance: [] };
  for (const b of await bases()) {
    try {
      const [t] = await enBase(b.url, `SELECT pg_size_pretty(pg_database_size(current_database())) AS tamano`, []);
      let documentos = {};
      try {
        const filas = await enBase(b.url, `SELECT tipo || '_' || estado AS k, count(*)::int AS n FROM documentos GROUP BY 1`, []);
        for (const f of filas) documentos[f.k] = f.n;
      } catch (e) {
        if (!tablaFaltante(e)) throw e;
        documentos = "tabla aun no creada";
      }
      salida.bases.push({ base: b.numero, tamano: t.tamano, documentos });
      // El avance de la indexacion esta en la base de control (texto 2)
      if (b.numero === 2) {
        try {
          salida.avance = await enBase(
            b.url,
            `SELECT trabajador, cursor::text AS hasta, terminado, procesados, actualizado::text AS actualizado
             FROM avance ORDER BY trabajador`,
            []
          );
        } catch (e) {
          salida.avance = [];
        }
      }
    } catch (e) {
      console.error(e);
      salida.bases.push({ base: b.numero, error: "no se pudo consultar" });
    }
  }
  return salida;
}
