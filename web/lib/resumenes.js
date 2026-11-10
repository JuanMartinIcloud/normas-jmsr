import { consultarGuardado, hoyLima } from "./db";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PORTAL = "https://wb2server.congreso.gob.pe/spley-portal/#";

// Enlace a la ficha del proyecto en el portal del Congreso
export function urlProyecto(p) {
  if (p.url) return p.url;
  if (!p.periodo || p.num_pley === null || p.num_pley === undefined) return null;
  const prefijo = p.camara === "S" ? "senado" : p.camara === "D" ? "diputados" : "congreso";
  return `${PORTAL}/${prefijo}/expediente/${p.periodo}/${p.num_pley}`;
}

// "2026-10-11" -> "sábado, 11 de octubre de 2026"
export function fechaLarga(fecha) {
  return new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ayerLima() {
  const d = new Date(`${hoyLima()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Si la tabla aun no existe (antes de la primera ejecucion del resumen), no es un error
function tablaFaltante(e) {
  return e && (e.code === "42P01" || /relation .*resumenes.* does not exist/i.test(String(e.message)));
}

function codigos(datos) {
  const refs = [];
  const agregar = (lista) => (lista || []).forEach((x) => refs.push(...(x.refs || [])));
  agregar(datos.destacadas);
  (datos.temas || []).forEach((t) => agregar(t.puntos));
  agregar(datos.proyectos);
  agregar(datos.avances);
  const normas = new Set();
  const proyectos = new Set();
  for (const r of refs) {
    const m = /^([NP])(\d{1,18})$/.exec(String(r));
    if (!m) continue;
    (m[1] === "N" ? normas : proyectos).add(m[2]);
  }
  return { normas: [...normas], proyectos: [...proyectos] };
}

// Devuelve el resumen de una fecha (o el mas reciente) con los datos de cada norma y proyecto citado
export async function cargarResumen(fecha = "") {
  let filas;
  try {
    filas = FECHA.test(fecha)
      ? await consultarGuardado(
          `SELECT fecha::text AS fecha, datos, modelo, n_normas, n_proyectos, n_cambios, creado_en
           FROM resumenes WHERE fecha = $1`,
          [fecha]
        )
      : await consultarGuardado(
          `SELECT fecha::text AS fecha, datos, modelo, n_normas, n_proyectos, n_cambios, creado_en
           FROM resumenes WHERE fecha <= $1 ORDER BY fecha DESC LIMIT 1`,
          [hoyLima()]
        );
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
  if (!filas.length) return null;

  const fila = filas[0];
  const datos = typeof fila.datos === "string" ? JSON.parse(fila.datos) : fila.datos || {};
  const { normas, proyectos } = codigos(datos);

  const [listaNormas, listaProyectos] = await Promise.all([
    normas.length
      ? consultarGuardado(
          `SELECT id::text AS id, tipo, numero, url_detalle, url_pdf FROM normas WHERE id = ANY($1::bigint[])`,
          [normas]
        )
      : [],
    proyectos.length
      ? consultarGuardado(
          `SELECT id::text AS id, numero, periodo, camara, num_pley, url FROM proyectos_ley WHERE id = ANY($1::bigint[])`,
          [proyectos]
        )
      : [],
  ]);

  const referencias = {};
  for (const n of listaNormas) {
    referencias[`N${n.id}`] = {
      texto: [n.tipo, n.numero].filter(Boolean).join(" N° ") || "Norma",
      url: n.url_detalle || n.url_pdf || null,
    };
  }
  for (const p of listaProyectos) {
    referencias[`P${p.id}`] = { texto: `PL ${p.numero}`, url: urlProyecto(p) };
  }
  return { ...fila, datos, referencias };
}

// Fechas que tienen resumen, de la mas reciente a la mas antigua
export async function fechasConResumen(limite = 90) {
  try {
    return await consultarGuardado(
      `SELECT fecha::text AS fecha, n_normas, n_proyectos FROM resumenes ORDER BY fecha DESC LIMIT ${Number(limite) || 90}`
    );
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
