import { consultar, consultarGuardado } from "./db";
import { renovar } from "./bases";
import { finDeMes, hoyLima } from "./monitoreo";
import { Aviso } from "./errores";

// Monitoreo por areas: lista de areas, reporte de un area en un mes, pedidos «Revisar este mes» y su avance.
// Las tablas las crea y llena la tarea src/areas.py (areas, area_cobertura, area_revision, area_pedidos).

export const REPO = "JuanMartinIcloud/normas-jmsr";
export const MES = /^\d{4}-\d{2}$/;

// Segundos promedio por consulta a la IA (medidos en el sistema actual) y documentos por consulta del filtro
const SEG_FILTRO = 10;
const SEG_ANALISIS = 14;
const LOTE_FILTRO = 40;

export async function listarAreas() {
  return consultarGuardado(
    `SELECT a.id, a.nombre, a.descripcion, a.origen,
            (SELECT count(*) FROM area_revision r WHERE r.area_id = a.id)::int AS documentos
     FROM areas a WHERE a.activa ORDER BY a.nombre`,
    [],
    "monitoreo"
  );
}

export async function areaPorId(id) {
  if (!/^\d{1,9}$/.test(String(id || ""))) return null;
  const [a] = await consultar(`SELECT id, nombre, descripcion, origen, sinonimos FROM areas WHERE id = $1 AND activa`, [Number(id)]);
  return a || null;
}

// Cobertura de un area en un mes: documentos del mes y cuantos ya se revisaron para esa area
export async function coberturaArea(areaId, mes) {
  const desde = `${mes}-01`;
  const hasta = finDeMes(mes);
  const [f] = await consultar(
    `SELECT
       (SELECT count(*) FROM normas n WHERE n.fecha BETWEEN $2 AND $3)::int AS normas,
       (SELECT count(*) FROM normas n JOIN area_cobertura c ON c.tipo = 'N' AND c.ref_id = n.id
          WHERE n.fecha BETWEEN $2 AND $3 AND $1 = ANY(c.areas))::int AS normas_revisadas,
       (SELECT count(*) FROM proyectos_ley p
          WHERE p.fecha_presentacion BETWEEN $2 AND $3 OR p.ley_fecha BETWEEN $2 AND $3)::int AS proyectos,
       (SELECT count(*) FROM proyectos_ley p JOIN area_cobertura c ON c.tipo = 'P' AND c.ref_id = p.id
          WHERE (p.fecha_presentacion BETWEEN $2 AND $3 OR p.ley_fecha BETWEEN $2 AND $3)
            AND $1 = ANY(c.areas))::int AS proyectos_revisados`,
    [Number(areaId), desde, hasta]
  );
  const total = f.normas + f.proyectos;
  const revisados = f.normas_revisadas + f.proyectos_revisados;
  return { ...f, total, revisados, faltan: total - revisados };
}

// Minutos estimados para revisar lo que falta de un area en un mes: el filtro lee 40 documentos por
// consulta y solo los que afectan al area se analizan (una consulta cada uno). La proporcion de documentos
// que afectan al area sale de lo ya revisado para esa area (o 8 % si todavia no hay datos).
export async function estimarMinutos(areaId, faltan) {
  if (!faltan) return 0;
  const [t] = await consultar(
    `SELECT (SELECT count(*) FROM area_revision WHERE area_id = $1)::float AS relevantes,
            (SELECT count(*) FROM area_cobertura WHERE $1 = ANY(areas))::float AS revisados`,
    [Number(areaId)]
  );
  const tasa = t.revisados >= 200 ? Math.min(0.5, Math.max(0.01, t.relevantes / t.revisados)) : 0.08;
  const segundos = Math.ceil(faltan / LOTE_FILTRO) * SEG_FILTRO + Math.round(faltan * tasa) * SEG_ANALISIS + 60;
  return Math.max(1, Math.round(segundos / 60));
}

// Filtros del reporte de un area
export function leerFiltrosArea(sp = {}) {
  const v = (k) => (typeof sp[k] === "string" ? sp[k].trim() : "");
  const mes = MES.test(v("mes")) ? v("mes") : hoyLima().slice(0, 7);
  return {
    mes,
    calificacion: ["Favorable", "Desfavorable", "Para seguimiento"].includes(v("calificacion")) ? v("calificacion") : "",
    impacto: ["Alto", "Moderado", "Bajo"].includes(v("impacto")) ? v("impacto") : "",
    tipo: ["N", "P"].includes(v("tipo")) ? v("tipo") : "",
  };
}

// Documentos que afectan al area en el mes, del mayor al menor puntaje
export async function reporteArea(areaId, f) {
  const cond = [];
  const params = [Number(areaId), `${f.mes}-01`, finDeMes(f.mes)];
  const p = (x) => {
    params.push(x);
    return `$${params.length}`;
  };
  if (f.calificacion) cond.push(`r.calificacion = ${p(f.calificacion)}`);
  if (f.impacto) cond.push(`r.impacto = ${p(f.impacto)}`);
  if (f.tipo) cond.push(`r.tipo = ${p(f.tipo)}`);
  return consultar(
    `SELECT r.tipo, r.ref_id::text AS ref_id, to_char(r.fecha, 'YYYY-MM-DD') AS fecha, r.calificacion, r.puntaje,
            r.impacto, r.resumen, r.cambios, r.comentario, r.lectura,
            n.tipo AS n_tipo, n.numero AS n_numero, n.entidad, n.sumilla, n.url_detalle,
            pl.numero AS p_numero, pl.camara, pl.titulo, pl.estado, pl.url AS p_url,
            pl.ley_numero, pl.ley_tipo
     FROM area_revision r
     LEFT JOIN normas n ON r.tipo = 'N' AND n.id = r.ref_id
     LEFT JOIN proyectos_ley pl ON r.tipo = 'P' AND pl.id = r.ref_id
     WHERE r.area_id = $1 AND r.fecha BETWEEN $2 AND $3 ${cond.length ? "AND " + cond.join(" AND ") : ""}
     ORDER BY r.puntaje DESC, r.fecha DESC, r.ref_id DESC
     LIMIT 1000`,
    params
  );
}

// Cifras del reporte (sin filtros): por calificacion y por impacto
export async function cifrasArea(areaId, mes) {
  const [c] = await consultar(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE calificacion = 'Favorable')::int AS favorables,
            count(*) FILTER (WHERE calificacion = 'Desfavorable')::int AS desfavorables,
            count(*) FILTER (WHERE calificacion = 'Para seguimiento')::int AS seguimiento,
            count(*) FILTER (WHERE impacto = 'Alto')::int AS altos,
            count(*) FILTER (WHERE tipo = 'N')::int AS normas,
            count(*) FILTER (WHERE tipo = 'P')::int AS proyectos
     FROM area_revision WHERE area_id = $1 AND fecha BETWEEN $2 AND $3`,
    [Number(areaId), `${mes}-01`, finDeMes(mes)]
  );
  return c;
}

// Pedido abierto (pendiente o en curso) de un area y un mes, o null
export async function pedidoAbierto(areaId, mes) {
  const [p] = await consultar(
    `SELECT id, estado, total, hechos, estimado_min, creado_en, empezado_en FROM area_pedidos
     WHERE area_id = $1 AND mes = $2 AND estado <> 'hecho' ORDER BY id DESC LIMIT 1`,
    [Number(areaId), mes]
  );
  return p || null;
}

export async function crearPedido(areaId, mes, quien) {
  if (!MES.test(mes)) throw new Aviso("Mes inválido.");
  if (mes > hoyLima().slice(0, 7) || mes < "2015-01") throw new Aviso("Ese mes no está disponible.");
  const area = await areaPorId(areaId);
  if (!area) throw new Aviso("Esa área no existe.");
  const abierto = await pedidoAbierto(area.id, mes);
  if (abierto) return abierto;
  const cob = await coberturaArea(area.id, mes);
  const estimado = await estimarMinutos(area.id, cob.faltan);
  const [p] = await consultar(
    `INSERT INTO area_pedidos (area_id, mes, total, estimado_min, creado_por) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (area_id, mes) WHERE estado <> 'hecho' DO UPDATE SET estimado_min = EXCLUDED.estimado_min
     RETURNING id, estado, total, hechos, estimado_min, creado_en, empezado_en`,
    [area.id, mes, cob.faltan, estimado, quien]
  );
  return p;
}

// Avance de un pedido, con los minutos que faltan (segun el ritmo real, o el estimado si recien empieza)
export async function avancePedido(id) {
  if (!/^\d{1,9}$/.test(String(id || ""))) return null;
  const [p] = await consultar(
    `SELECT id, estado, total, hechos, estimado_min, EXTRACT(EPOCH FROM (now() - coalesce(empezado_en, now())))::int AS seg
     FROM area_pedidos WHERE id = $1`,
    [Number(id)]
  );
  if (!p) return null;
  let restante = p.estimado_min;
  if (p.estado === "en_curso" && p.hechos > 20 && p.total) {
    restante = Math.max(1, Math.round(((p.total - p.hechos) * (p.seg / p.hechos)) / 60));
  } else if (p.estado === "hecho") {
    restante = 0;
  }
  if (p.estado === "hecho") renovar("monitoreo");
  return { ...p, restante };
}

// Lanza la tarea de areas al momento (si esta configurada la clave GITHUB_TAREAS en Vercel)
export async function lanzarTarea() {
  const clave = (process.env.GITHUB_TAREAS || "").trim();
  if (!clave) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/areas.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { modo: "pedidos" } }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (r.status !== 204) console.error(`GitHub respondio ${r.status} al lanzar la tarea de areas`);
    return r.status === 204;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// Agrega un area nueva (ya revisada por la IA para que no repita otra) y devuelve su id
export async function agregarArea(nombre, descripcion, quien, sinonimo) {
  const [a] = await consultar(
    `INSERT INTO areas (nombre, descripcion, origen, creada_por, sinonimos) VALUES ($1, $2, 'usuario', $3, $4)
     ON CONFLICT (nombre) DO UPDATE SET activa = TRUE RETURNING id`,
    [nombre, descripcion, quien, sinonimo && sinonimo !== nombre ? [sinonimo] : []]
  );
  renovar("monitoreo");
  return a.id;
}

// Anota el nombre con que alguien pidio un area que ya existia (ayuda a reconocerla la proxima vez)
export async function anotarSinonimo(id, texto) {
  await consultar(
    `UPDATE areas SET sinonimos = array_append(sinonimos, $2)
     WHERE id = $1 AND NOT ($2 = ANY(sinonimos)) AND lower(nombre) <> lower($2) AND cardinality(sinonimos) < 30`,
    [Number(id), texto]
  );
}
