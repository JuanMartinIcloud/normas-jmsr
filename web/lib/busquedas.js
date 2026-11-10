import { randomBytes } from "node:crypto";
import { colsLey, estadoProyecto } from "./leyes";
import { consultar, leerFiltros, construirWhere, prepararBusqueda, ordenNormas } from "./db";
import { leerFiltrosProyectos, whereProyectos, ordenProyectos } from "./proyectos";
import { urlProyecto } from "./resumenes";
import { generarJSON } from "./gemini";
import { mensajeError } from "./errores";
import { anotarPedidos, estadoImpacto } from "./pedidos";

// Busquedas guardadas: una pregunta (interpretada por la IA en terminos) + filtros, que se ejecuta
// sola con la frecuencia elegida y guarda cada resultado con un resumen de IA.

export const FRECUENCIAS = {
  diaria: "Diaria (lo publicado el día anterior)",
  semanal: "Semanal (cada lunes, la semana anterior)",
  quincenal: "Quincenal (los días 1 y 16, la quincena anterior)",
  mensual: "Mensual (el día 1, el mes anterior)",
};

let listo = false;
export async function asegurarTablas() {
  if (listo) return;
  await consultar(`CREATE TABLE IF NOT EXISTS busquedas_guardadas (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, pregunta TEXT, q TEXT, terminos TEXT[] NOT NULL DEFAULT '{}',
    refinar TEXT[] NOT NULL DEFAULT '{}', frecuencia TEXT NOT NULL DEFAULT 'diaria', con_resumen BOOLEAN NOT NULL DEFAULT TRUE,
    destinatarios TEXT[] NOT NULL DEFAULT '{}', activa BOOLEAN NOT NULL DEFAULT TRUE, creado_por TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(), ultima_ejecucion TIMESTAMPTZ)`);
  await consultar(`CREATE TABLE IF NOT EXISTS busqueda_ejecuciones (
    id BIGSERIAL PRIMARY KEY, busqueda_id INTEGER NOT NULL REFERENCES busquedas_guardadas(id) ON DELETE CASCADE,
    desde DATE NOT NULL, hasta DATE NOT NULL, total_normas INTEGER, total_proyectos INTEGER,
    normas JSONB, proyectos JSONB, resumen JSONB, enviado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (busqueda_id, desde, hasta))`);
  listo = true;
}

// Clave interna para que la tarea automatica pueda pedir la ejecucion
export async function claveTareas() {
  const f = await consultar(`SELECT valor FROM configuracion WHERE clave = 'clave_tareas'`);
  if (f.length) return f[0].valor;
  await consultar(`INSERT INTO configuracion (clave, valor) VALUES ('clave_tareas', $1) ON CONFLICT DO NOTHING`, [
    randomBytes(24).toString("hex"),
  ]);
  return (await consultar(`SELECT valor FROM configuracion WHERE clave = 'clave_tareas'`))[0].valor;
}

const dia = (d) => d.toISOString().slice(0, 10);
const hoyLimaDate = () => new Date(Date.now() - 5 * 3600 * 1000);

// Periodo que le toca a una frecuencia en la fecha dada (null si hoy no le toca)
export function periodoDe(frecuencia, base = hoyLimaDate(), forzar = false) {
  const y = base.getUTCFullYear(), m = base.getUTCMonth(), d = base.getUTCDate();
  const fecha = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd));
  if (frecuencia === "diaria") {
    const ayer = fecha(y, m, d - 1);
    return { desde: dia(ayer), hasta: dia(ayer) };
  }
  if (frecuencia === "semanal") {
    if (base.getUTCDay() !== 1 && !forzar) return null;
    const offset = forzar ? (base.getUTCDay() + 6) % 7 : 0; // lunes de esta semana
    const lunes = fecha(y, m, d - offset);
    return { desde: dia(new Date(lunes.getTime() - 7 * 864e5)), hasta: dia(new Date(lunes.getTime() - 864e5)) };
  }
  if (frecuencia === "quincenal") {
    if (d !== 1 && d !== 16 && !forzar) return null;
    if (d >= 16) return { desde: dia(fecha(y, m, 1)), hasta: dia(fecha(y, m, 15)) };
    return { desde: dia(fecha(y, m - 1, 16)), hasta: dia(fecha(y, m, 0)) };
  }
  if (frecuencia === "mensual") {
    if (d !== 1 && !forzar) return null;
    return { desde: dia(fecha(y, m - 1, 1)), hasta: dia(fecha(y, m, 0)) };
  }
  return null;
}

// Parametros de la direccion del buscador para abrir la busqueda en un periodo
export function urlBuscador(b, desde = "", hasta = "") {
  const p = new URLSearchParams();
  if (b.pregunta) p.set("pregunta", b.pregunta);
  if (b.q) p.set("q", b.q);
  if (b.terminos?.length) p.set("t", b.terminos.join("|"));
  if (b.refinar?.length) p.set("y", b.refinar.join("|"));
  if (b.pregunta) p.set("orden", "r");
  if (desde) p.set("desde", desde);
  if (hasta) p.set("hasta", hasta);
  return `/buscar?${p.toString()}`;
}

const RESUMEN = {
  type: "OBJECT",
  properties: { panorama: { type: "STRING" }, puntos: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["panorama", "puntos"],
};

// Ejecuta una busqueda guardada para un periodo y guarda el resultado
export async function ejecutar(b, desde, hasta) {
  const base = {
    q: b.q || "", t: (b.terminos || []).join("|"), y: (b.refinar || []).join("|"),
    desde, hasta, orden: b.pregunta ? "r" : "",
  };
  const fn = leerFiltros(base);
  const fp = leerFiltrosProyectos(base);
  await Promise.all([prepararBusqueda(fn, "N"), prepararBusqueda(fp, "P")]);
  const wn = construirWhere(fn);
  const wp = whereProyectos(fp);
  const pn = [...wn.params];
  const pp = [...wp.params];
  const [ns, [cn], ps, [cp]] = await Promise.all([
    consultar(
      `SELECT id::text AS id, fecha::text AS fecha, tipo, numero, entidad, sumilla, url_detalle FROM normas ${wn.where}
       ORDER BY ${ordenNormas(fn, pn)} LIMIT 60`, pn),
    consultar(`SELECT count(*)::int AS n FROM normas ${wn.where}`, wn.params),
    consultar(
      `SELECT id::text AS id, numero, periodo, camara, num_pley, url, fecha_presentacion::text AS fecha, titulo, estado, ${colsLey("proyectos_ley")}
       FROM proyectos_ley ${wp.where} ORDER BY ${ordenProyectos(fp, pp)} LIMIT 60`, pp),
    consultar(`SELECT count(*)::int AS n FROM proyectos_ley ${wp.where}`, wp.params),
  ]);
  const normas = ns.map((n) => ({
    id: n.id, nombre: [n.tipo, n.numero].filter(Boolean).join(" N° "), entidad: n.entidad, fecha: n.fecha, sumilla: n.sumilla, url: n.url_detalle,
  }));
  const proyectos = ps.map((p) => ({ id: p.id, nombre: `Proyecto ${p.numero}`, fecha: p.fecha, titulo: p.titulo, estado: estadoProyecto(p), url: urlProyecto(p) }));
  let resumen = null;
  if (b.con_resumen && (normas.length || proyectos.length)) {
    try {
      const lista = [
        ...normas.slice(0, 50).map((n) => `NORMA ${n.nombre} (${n.fecha}, ${n.entidad}): ${n.sumilla}`),
        ...proyectos.slice(0, 50).map((p) => `PROYECTO ${p.nombre} (${p.fecha}, ${p.estado}): ${p.titulo}`),
      ];
      const { datos } = await generarJSON({
        instrucciones: `Eres un abogado peruano. Resume lo encontrado por una búsqueda guardada sobre «${b.pregunta || b.q || b.nombre}»
entre el ${desde} y el ${hasta}. Español claro. Usa solo los datos recibidos y cita normas y proyectos por su número.
"panorama": 2 a 4 oraciones; "puntos": 3 a 8 puntos con lo más relevante. Responde solo con el JSON pedido.`,
        partes: [{ text: lista.join("\n") }],
        esquema: RESUMEN,
        maxTokens: 4096,
        limiteMs: 90000,
        intentoMs: 45000,
        perfil: "automatico",
        origen: "busqueda guardada",
      });
      resumen = { panorama: String(datos.panorama || ""), puntos: (datos.puntos || []).map(String) };
    } catch (e) {
      resumen = { error: mensajeError(e) };
    }
  }
  const [fila] = await consultar(
    `INSERT INTO busqueda_ejecuciones (busqueda_id, desde, hasta, total_normas, total_proyectos, normas, proyectos, resumen)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
     ON CONFLICT (busqueda_id, desde, hasta) DO UPDATE SET total_normas = EXCLUDED.total_normas,
       total_proyectos = EXCLUDED.total_proyectos, normas = EXCLUDED.normas, proyectos = EXCLUDED.proyectos,
       resumen = EXCLUDED.resumen, creado_en = now()
     RETURNING id`,
    [b.id, desde, hasta, cn.n, cp.n, JSON.stringify(normas), JSON.stringify(proyectos), JSON.stringify(resumen)]
  );
  await consultar(`UPDATE busquedas_guardadas SET ultima_ejecucion = now() WHERE id = $1`, [b.id]);
  // La IA debe revisar todo: lo que salio en la busqueda y aun no tiene su revision empresarial se pide
  const estados = await estadoImpacto(normas.map((x) => x.id), proyectos.map((x) => x.id));
  const sinRevisar = [
    ...normas.filter((x) => estados[`N${x.id}`] === "sin_revisar").map((x) => ({ tipo: "N", ref: x.id })),
    ...proyectos.filter((x) => estados[`P${x.id}`] === "sin_revisar").map((x) => ({ tipo: "P", ref: x.id })),
  ];
  const pedidos = await anotarPedidos(sinRevisar, "Búsqueda guardada");
  return { id: fila.id, total_normas: cn.n, total_proyectos: cp.n, normas, proyectos, resumen, desde, hasta, pedidos };
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function htmlEjecucion(b, r, sitio) {
  const lista = (items, texto) =>
    items.length
      ? `<ul>${items.slice(0, 40).map((x) => `<li>${x.url ? `<a href="${esc(x.url)}">${esc(x.nombre)}</a>` : esc(x.nombre)} (${esc(x.fecha)}) — ${esc(texto(x))}</li>`).join("")}</ul>`
      : `<p style="color:#666">Sin resultados.</p>`;
  const resumen = r.resumen && !r.resumen.error
    ? `<h2 style="font-size:16px">Resumen</h2><p>${esc(r.resumen.panorama)}</p><ul>${r.resumen.puntos.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`
    : "";
  return `<div style="font-family:Arial,sans-serif;max-width:760px;color:#222">
<h1 style="font-size:20px;color:#8f1d2c">${esc(b.nombre)}</h1>
<p style="color:#555">Búsqueda guardada: «${esc(b.pregunta || b.q)}» · del ${esc(r.desde)} al ${esc(r.hasta)} ·
${r.total_normas} normas legales y ${r.total_proyectos} proyectos de ley.</p>
${resumen}
<h2 style="font-size:16px">Normas legales (${r.total_normas})</h2>${lista(r.normas, (x) => x.sumilla)}
<h2 style="font-size:16px">Proyectos de ley (${r.total_proyectos})</h2>${lista(r.proyectos, (x) => x.titulo)}
<p><a href="${esc(sitio + urlBuscador(b, r.desde, r.hasta))}">Ver todos los resultados en el buscador</a></p></div>`;
}
