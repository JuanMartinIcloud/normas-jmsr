import { consultar, consultarGuardado } from "./db";
import { renovar } from "./bases";
import { colsLey } from "./leyes";

// Datos de los reportes del monitoreo empresarial (tabla "analisis" + normas / proyectos / seguimiento)

export const COMITES = [
  "Dispositivos Médicos", "Educación", "Facilitación de Comercio", "Infraestructura, Energía y Minería",
  "Minería", "Proveedores de Infraestructura Pasiva", "Salud", "Supply Chain Management",
  "Telecomunicaciones", "Turismo", "Asuntos Corporativos", "Asuntos Financieros", "Asuntos Jurídicos",
  "Asuntos Tributarios", "Desarrollo Sostenible", "Comunicación Interna", "Compliance",
  "Diversidad & Inclusión", "Gestión Humana", "Innovación", "Management Support", "Marketing",
];
export const CALIFICACIONES = ["Favorable", "Desfavorable", "Para seguimiento"];
export const IMPACTOS = ["Alto", "Moderado", "Bajo"];
// Nivel de impacto segun el puntaje (1 a 10): Alto 8-10, Moderado 5-7, Bajo 1-4

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

export function hoyLima() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
export function ayerLima() {
  return new Date(Date.now() - 29 * 3600 * 1000).toISOString().slice(0, 10);
}
export function finDeMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function nombreMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}
export function fechaLarga(f) {
  const d = new Date(`${f}T12:00:00Z`);
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

// Puntaje de impacto: entero del 1 al 10 (o 0 si no se indico)
function puntaje(x) {
  const n = Number(x);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 0;
}

// Filtros comunes (vienen en la direccion de la pagina)
export function leerFiltrosMonitoreo(sp = {}) {
  const v = (k) => (typeof sp[k] === "string" ? sp[k].trim() : "");
  const mesActual = hoyLima().slice(0, 7);
  return {
    mes: MES.test(v("mes")) ? v("mes") : mesActual,
    fecha: FECHA.test(v("fecha")) ? v("fecha") : "",
    texto: v("texto").slice(0, 100),
    sector: v("sector").slice(0, 80),
    calificacion: CALIFICACIONES.includes(v("calificacion")) ? v("calificacion") : "",
    impacto: IMPACTOS.includes(v("impacto")) ? v("impacto") : "",
    comite: COMITES.includes(v("comite")) ? v("comite") : "",
    tipoNorma: v("tipo_norma").slice(0, 80),
    entidad: v("entidad").slice(0, 100),
    puntajeMin: puntaje(v("puntaje_min")),
    puntajeMax: puntaje(v("puntaje_max")),
    quitados: v("quitados") === "1",
  };
}

// Condiciones sobre la tabla analisis (alias a) y el texto del documento
function condAnalisis(f, p, textoDoc) {
  const c = ["a.relevante"];
  if (!f.quitados) c.push("NOT a.excluido");
  if (f.sector) c.push(`a.sector = ${p(f.sector)}`);
  if (f.calificacion) c.push(`a.calificacion = ${p(f.calificacion)}`);
  if (f.impacto) c.push(`a.impacto = ${p(f.impacto)}`);
  if (f.puntajeMin) c.push(`a.puntaje >= ${p(f.puntajeMin)}`);
  if (f.puntajeMax) c.push(`a.puntaje <= ${p(f.puntajeMax)}`);
  if (f.comite) c.push(`${p(f.comite)} = ANY(a.comites)`);
  if (f.texto) {
    const t = p(`%${f.texto}%`);
    c.push(`(a.resumen ILIKE ${t} OR a.comentario ILIKE ${t} OR a.cambios ILIKE ${t} OR ${textoDoc} ILIKE ${t})`);
  }
  return c;
}

function armar() {
  const params = [];
  const p = (x) => {
    params.push(x);
    return `$${params.length}`;
  };
  return { params, p };
}

const COLS_A = `a.id AS analisis_id, a.tipo AS a_tipo, a.ref_id, a.resumen, a.cambios, a.comentario, a.sector,
  a.calificacion, a.impacto, a.puntaje, a.comites, a.acciones, a.accion_directorio, a.lectura, a.excluido, a.excluido_por`;

// Normas analizadas de un periodo [desde, hasta]
export async function normasAnalizadas(f, desde, hasta) {
  const { params, p } = armar();
  const c = condAnalisis(f, p, "n.sumilla");
  c.push(`n.fecha BETWEEN ${p(desde)} AND ${p(hasta)}`);
  if (f.tipoNorma) c.push(`translate(lower(n.tipo), 'áéíóúü', 'aeiouu') = translate(lower(${p(f.tipoNorma)}), 'áéíóúü', 'aeiouu')`);
  if (f.entidad) c.push(`n.entidad ILIKE ${p(`%${f.entidad}%`)}`);
  return consultarGuardado(
    `SELECT ${COLS_A}, n.fecha::text AS fecha, n.tipo, n.numero, n.entidad, n.sumilla, n.url_detalle, n.url_pdf
     FROM analisis a JOIN normas n ON n.id = a.ref_id AND a.tipo = 'N'
     WHERE ${c.join(" AND ")}
     ORDER BY a.puntaje DESC NULLS LAST, CASE a.impacto WHEN 'Alto' THEN 0 WHEN 'Moderado' THEN 1 ELSE 2 END, n.fecha DESC, n.id DESC
     LIMIT 1500`,
    params, "monitoreo"
  );
}

// Cuantas normas del periodo faltan analizar y cuantas se descartaron por no ser relevantes
export async function avanceNormas(desde, hasta) {
  const [r] = await consultarGuardado(
    `SELECT count(*)::int AS total,
            count(a.id)::int AS revisadas,
            count(*) FILTER (WHERE a.relevante)::int AS relevantes
     FROM normas n LEFT JOIN analisis a ON a.tipo = 'N' AND a.ref_id = n.id
     WHERE n.fecha BETWEEN $1 AND $2`,
    [desde, hasta], "monitoreo"
  );
  return r;
}

const COLS_P = `p.id AS proyecto_id, p.numero, p.camara, p.periodo, p.num_pley, p.url, p.titulo, p.sumilla AS sumilla_p,
  p.proponente, p.autor, p.estado, p.fecha_presentacion::text AS fecha_presentacion, ${colsLey("p")}`;

const COND_DICTAMEN = "s.estado ILIKE '%dictamen%'";
const COND_AUTOGRAFA = "s.estado ILIKE '%aut_grafa%'";
const COND_PUBLICADA = "s.estado ILIKE 'publicad%'";
const COND_REMITIDO_SENADO = "(s.estado ILIKE '%remitid%senado%' OR s.estado ILIKE '%senado de la rep%')";

// Proyectos con analisis (o sin el: pendientes / no relevantes) para una lista de condiciones SQL
async function proyectosCon(f, base, paramsBase, extraSel = "") {
  const { params, p } = armar();
  for (const x of paramsBase) p(x);
  const ca = condAnalisis(f, p, "(coalesce(p.titulo,'') || ' ' || coalesce(p.sumilla,''))");
  return consultarGuardado(
    `SELECT ${COLS_P}${extraSel}, ${COLS_A}
     FROM (${base}) b JOIN proyectos_ley p ON p.id = b.pid
     LEFT JOIN analisis a ON a.tipo = 'P' AND a.ref_id = p.id
     WHERE ${ca.join(" AND ")}
     ORDER BY a.puntaje DESC NULLS LAST, CASE a.impacto WHEN 'Alto' THEN 0 WHEN 'Moderado' THEN 1 ELSE 2 END, p.numero`,
    params, "monitoreo"
  );
}

async function conteo(base, params) {
  const [r] = await consultarGuardado(
    `SELECT count(DISTINCT b.pid)::int AS total,
            count(DISTINCT b.pid) FILTER (WHERE a.id IS NULL)::int AS pendientes,
            count(DISTINCT b.pid) FILTER (WHERE a.relevante)::int AS relevantes
     FROM (${base}) b LEFT JOIN analisis a ON a.tipo = 'P' AND a.ref_id = b.pid`,
    params, "monitoreo"
  );
  return r;
}

// Reporte del Congreso para un dia (o un rango de dias): 3 secciones
export async function reporteCongreso(f, desde, hasta) {
  const dia = `(s.fecha AT TIME ZONE 'America/Lima')::date BETWEEN $1 AND $2`;
  const bases = {
    diputados_ingresadas: `SELECT p.id AS pid, NULL::text AS comisiones, NULL::text AS detalle, p.fecha_presentacion::text AS cuando
        FROM proyectos_ley p WHERE p.camara = 'D' AND p.fecha_presentacion BETWEEN $1 AND $2`,
    diputados_dictamenes: `SELECT DISTINCT ON (s.proyecto_id) s.proyecto_id AS pid, s.comisiones, s.detalle,
          (s.fecha AT TIME ZONE 'America/Lima')::date::text AS cuando
        FROM seguimientos s WHERE s.camara IN ('D', 'C') AND ${COND_DICTAMEN} AND ${dia} ORDER BY s.proyecto_id, s.fecha DESC`,
    senado_ingresadas: `SELECT p.id AS pid, NULL::text AS comisiones, 'Presentada en el Senado' AS detalle, p.fecha_presentacion::text AS cuando
          FROM proyectos_ley p WHERE p.camara = 'S' AND p.fecha_presentacion BETWEEN $1 AND $2
        UNION ALL
        (SELECT DISTINCT ON (s.proyecto_id) s.proyecto_id, s.comisiones, coalesce(s.detalle, s.estado),
          (s.fecha AT TIME ZONE 'America/Lima')::date::text
          FROM seguimientos s WHERE ${COND_REMITIDO_SENADO} AND ${dia} ORDER BY s.proyecto_id, s.fecha DESC)`,
    senado_dictamenes: `SELECT DISTINCT ON (s.proyecto_id) s.proyecto_id AS pid, s.comisiones, s.detalle,
          (s.fecha AT TIME ZONE 'America/Lima')::date::text AS cuando
        FROM seguimientos s WHERE s.camara = 'S' AND ${COND_DICTAMEN} AND ${dia} ORDER BY s.proyecto_id, s.fecha DESC`,
    autografas: `SELECT DISTINCT ON (s.proyecto_id) s.proyecto_id AS pid, s.comisiones, coalesce(s.detalle, s.estado) AS detalle,
          (s.fecha AT TIME ZONE 'America/Lima')::date::text AS cuando
        FROM seguimientos s WHERE ${COND_AUTOGRAFA} AND ${dia} ORDER BY s.proyecto_id, s.fecha DESC`,
    // Proposiciones convertidas en ley ese dia (y fe de erratas de esas leyes)
    publicadas: `SELECT DISTINCT ON (s.proyecto_id) s.proyecto_id AS pid, NULL::text AS comisiones, coalesce(s.detalle, s.estado) AS detalle,
          (s.fecha AT TIME ZONE 'America/Lima')::date::text AS cuando
        FROM seguimientos s WHERE ${COND_PUBLICADA} AND ${dia} ORDER BY s.proyecto_id, s.fecha DESC`,
  };
  const salida = {};
  await Promise.all(
    Object.entries(bases).map(async ([k, base]) => {
      const [items, cuenta] = await Promise.all([
        proyectosCon(f, base, [desde, hasta], ", b.comisiones AS mov_comisiones, b.detalle AS mov_detalle, b.cuando AS mov_fecha"),
        conteo(base, [desde, hasta]),
      ]);
      salida[k] = { items, cuenta };
    })
  );
  return salida;
}

// Proyectos de un periodo: presentados en el periodo o con un movimiento importante en el periodo
const BASE_PROYECTOS_PERIODO = `SELECT p.id AS pid FROM proyectos_ley p WHERE p.fecha_presentacion BETWEEN $1 AND $2
                UNION SELECT s.proyecto_id FROM seguimientos s
                WHERE (s.fecha AT TIME ZONE 'America/Lima')::date BETWEEN $1 AND $2
                  AND (${COND_DICTAMEN} OR ${COND_AUTOGRAFA} OR ${COND_REMITIDO_SENADO} OR ${COND_PUBLICADA})`;

// Proyectos analizados de un periodo (para el modulo de impacto y el resumen)
export async function proyectosAnalizados(f, desde, hasta) {
  return proyectosCon(f, BASE_PROYECTOS_PERIODO, [desde, hasta]);
}

// Cuanto falta revisar con la IA en un mes (consulta en el momento: cambia apenas termina un analisis)
export async function estadoMes(mes) {
  const desde = `${mes}-01`;
  const hasta = finDeMes(mes);
  const [r] = await consultar(
    `SELECT (SELECT count(*)::int FROM normas n WHERE n.fecha BETWEEN $1 AND $2) AS normas,
            (SELECT count(*)::int FROM normas n WHERE n.fecha BETWEEN $1 AND $2
               AND NOT EXISTS (SELECT 1 FROM analisis a WHERE a.tipo = 'N' AND a.ref_id = n.id)) AS faltan_normas,
            (SELECT count(*)::int FROM (${BASE_PROYECTOS_PERIODO}) b
               WHERE NOT EXISTS (SELECT 1 FROM analisis a WHERE a.tipo = 'P' AND a.ref_id = b.pid)) AS faltan_proyectos`,
    [desde, hasta]
  );
  return r;
}

// Solo las cifras de un periodo (para comparar con el mes anterior): la base devuelve unas pocas filas
// de conteo en lugar de todos los documentos analizados.
export async function cifrasPeriodo(desde, hasta) {
  const filas = await consultarGuardado(
    `SELECT origen, calificacion, impacto, count(*)::int AS n FROM (
       SELECT 'N' AS origen, a.calificacion, a.impacto
       FROM analisis a JOIN normas n ON n.id = a.ref_id AND a.tipo = 'N'
       WHERE a.relevante AND NOT a.excluido AND n.fecha BETWEEN $1 AND $2
       UNION ALL
       SELECT 'P', a.calificacion, a.impacto
       FROM (${BASE_PROYECTOS_PERIODO}) b JOIN analisis a ON a.tipo = 'P' AND a.ref_id = b.pid
       WHERE a.relevante AND NOT a.excluido
     ) x GROUP BY 1, 2, 3`,
    [desde, hasta], "monitoreo"
  );
  const suma = (cond) => filas.filter(cond).reduce((t, r) => t + r.n, 0);
  return {
    normas: suma((r) => r.origen === "N"),
    proyectos: suma((r) => r.origen === "P"),
    cuenta: (campo, valor) => suma((r) => r[campo] === valor),
  };
}

// Opciones para los filtros (sectores y tipos de norma presentes)
export async function opcionesFiltros(desde, hasta) {
  const [sectores, tipos] = await Promise.all([
    consultarGuardado(`SELECT DISTINCT sector AS v FROM analisis WHERE relevante AND sector IS NOT NULL ORDER BY 1`, [], "monitoreo"),
    consultarGuardado(
      `SELECT max(n.tipo) AS v FROM analisis a JOIN normas n ON n.id = a.ref_id AND a.tipo = 'N'
       WHERE a.relevante AND n.fecha BETWEEN $1 AND $2
       GROUP BY translate(lower(n.tipo), 'áéíóúü', 'aeiouu') ORDER BY 1`,
      [desde, hasta], "monitoreo"
    ),
  ]);
  return { sectores: sectores.map((r) => r.v), tipos: tipos.map((r) => r.v) };
}

// Quitar o restaurar un item del reporte
export async function marcarExcluido(id, excluir, usuario) {
  await consultar(
    `UPDATE analisis SET excluido = $2, excluido_por = CASE WHEN $2 THEN $3 ELSE NULL END,
            excluido_en = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1`,
    [Number(id), Boolean(excluir), usuario]
  );
  renovar("monitoreo");
}
