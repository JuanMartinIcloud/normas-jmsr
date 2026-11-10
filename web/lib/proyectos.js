// Filtros y busqueda de proyectos de ley (los usa la pagina /proyectos, /buscar y la IA)
import { leerTerminos , esFraseSimple } from "./db";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function leerFiltrosProyectos(sp = {}) {
  const v = (k) => (typeof sp[k] === "string" ? sp[k].trim() : "");
  return {
    q: v("q").slice(0, 200),
    periodo: /^\d{4}$/.test(v("periodo")) ? v("periodo") : "",
    estado: v("estado").slice(0, 100),
    rubro: v("rubro").slice(0, 100),
    proponente: v("proponente").slice(0, 100),
    desde: FECHA.test(v("desde")) ? v("desde") : "",
    hasta: FECHA.test(v("hasta")) ? v("hasta") : "",
    terminos: leerTerminos(sp.t),
    refinar: leerTerminos(sp.y),
    pregunta: v("pregunta").slice(0, 300),
    orden: ["r", "f"].includes(v("orden")) ? v("orden") : "",
    pagina: Math.min(100, Math.max(1, parseInt(v("p"), 10) || 1)), // hasta la pagina 100
  };
}

// Arma el WHERE con parametros ($1, $2...) para evitar inyeccion SQL
export function whereProyectos(f) {
  const cond = [];
  const params = [];
  const p = (x) => {
    params.push(x);
    return `$${params.length}`;
  };
  if (f.periodo) cond.push(`periodo = ${p(f.periodo)}`);
  // "__ley": proposiciones ya convertidas en ley (publicadas en El Peruano)
  if (f.estado === "__ley") cond.push("ley_numero IS NOT NULL");
  else if (f.estado) cond.push(`estado = ${p(f.estado)}`);
  if (f.rubro) cond.push(`rubro = ${p(f.rubro)}`);
  if (f.proponente) cond.push(`proponente = ${p(f.proponente)}`);
  if (f.desde) cond.push(`fecha_presentacion >= ${p(f.desde)}`);
  if (f.hasta) cond.push(`fecha_presentacion <= ${p(f.hasta)}`);
  // Busca en el titulo y en la sumilla extensa del expediente (por palabras: reconoce plurales y
  // variantes; admite "frase exacta"), por texto en titulo, autores o numero, y en el texto completo
  const buscados = [f.q, ...(f.terminos || [])].filter(Boolean);
  let principal = "";
  if (buscados.length) {
    const partes = buscados.map((t) => `${TSV_PROYECTOS} @@ websearch_to_tsquery('spanish', ${p(t)})`);
    if (f.q) {
      const like = p(`%${f.q.replace(/"/g, "")}%`);
      partes.push(`titulo ILIKE ${like}`, `autor ILIKE ${like}`, `numero ILIKE ${like}`);
    }
    // Proyectos hallados en el texto completo de su PDF (ver prepararBusqueda)
    if (f.clavesTexto && f.clavesTexto.length) {
      partes.push(`${CLAVE_PROYECTO} = ANY(${p(f.clavesTexto)}::text[])`);
    }
    principal = `(${partes.join(" OR ")})`;
  }
  // Filtros sucesivos ("buscar dentro de estos resultados"): cada uno debe cumplirse ademas
  const refinar = f.refinar || [];
  if (refinar.length) {
    const ref = refinar.map((r, i) => {
      const like = p(`%${r.replace(/"/g, "")}%`);
      const alt = [
        `${TSV_PROYECTOS} @@ websearch_to_tsquery('spanish', ${p(r)})`,
        `titulo ILIKE ${like}`,
        `autor ILIKE ${like}`,
      ];
      const ks = (f.clavesRefinar || [])[i];
      if (ks && ks.length) alt.push(`${CLAVE_PROYECTO} = ANY(${p(ks)}::text[])`);
      return `(${alt.join(" OR ")})`;
    });
    let bloque = [principal, ...ref].filter(Boolean).join(" AND ");
    if (f.clavesTodas && f.clavesTodas.length) bloque = `(${bloque}) OR ${CLAVE_PROYECTO} = ANY(${p(f.clavesTodas)}::text[])`;
    cond.push(`(${bloque})`);
  } else if (principal) {
    cond.push(principal);
  }
  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

const TSV_PROYECTOS = "to_tsvector('spanish', coalesce(titulo,'') || ' ' || coalesce(sumilla,''))";
const CLAVE_PROYECTO = "(periodo || '|' || camara || '|' || numero)";

// Orden de los proyectos: por relevancia (busqueda con IA) o por fecha de presentacion
export function ordenProyectos(f, params) {
  const buscados = [f.q, ...(f.terminos || []), ...(f.refinar || [])].filter(Boolean);
  if (!buscados.length || f.orden === "f") return "fecha_presentacion DESC NULLS LAST, id DESC";
  if (f.orden !== "r") {
    // Por defecto: primero la frase exacta en el titulo/sumilla, luego en el texto completo, luego el resto
    if (!esFraseSimple(f.q)) return "fecha_presentacion DESC NULLS LAST, id DESC";
    params.push(f.q);
    const iq = params.length;
    let caso = `CASE WHEN ${TSV_PROYECTOS} @@ phraseto_tsquery('spanish', $${iq}) THEN 0`;
    if (f.clavesFrase && f.clavesFrase.length) {
      params.push(f.clavesFrase);
      caso += ` WHEN ${CLAVE_PROYECTO} = ANY($${params.length}::text[]) THEN 1`;
    }
    caso += ` WHEN ${TSV_PROYECTOS} @@ websearch_to_tsquery('spanish', $${iq}) THEN 2 ELSE 3 END`;
    return `${caso}, fecha_presentacion DESC NULLS LAST, id DESC`;
  }
  const q = buscados
    .map((t) => {
      params.push(t);
      return `websearch_to_tsquery('spanish', $${params.length})`;
    })
    .join(" || ");
  // Relevancia por el titulo (corto): ordenar por la sumilla completa es mucho mas lento
  return `ts_rank(to_tsvector('spanish', coalesce(titulo,'')), (${q})) DESC, fecha_presentacion DESC NULLS LAST, id DESC`;
}
