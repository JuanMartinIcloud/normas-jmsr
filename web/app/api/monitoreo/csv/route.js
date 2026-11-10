import { usuarioActual } from "../../../../lib/auth";
import { leerFiltrosMonitoreo, normasAnalizadas, proyectosAnalizados, reporteCongreso, finDeMes, ayerLima } from "../../../../lib/monitoreo";
import { leerPeriodo } from "../../../../lib/periodo";
import { urlProyecto } from "../../../../lib/resumenes";
import { estadoProyecto, recorrido } from "../../../../lib/leyes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function celda(v) {
  if (v === null || v === undefined) return "";
  const s = (Array.isArray(v) ? v.join("; ") : String(v)).replace(/\r?\n/g, " ");
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const acciones = (a) => (a || []).map((x) => `${x.comite}: ${x.accion}`).join(" | ");

const COLS = ["Sección", "Tipo", "Documento", "Fecha", "Entidad o proponente", "Descripción", "Movimiento", "Sector",
  "Calificación", "Impacto", "Puntaje (1 a 10)", "Comités", "En qué consiste", "Qué cambia", "Impacto empresarial", "Acciones de comités",
  "Acción del Directorio", "Enlace"];

function filaNorma(n, seccion = "Normas legales") {
  return [seccion, "Norma legal", [n.tipo, n.numero].filter(Boolean).join(" N° "), n.fecha, n.entidad, n.sumilla, "", n.sector,
    n.calificacion, n.impacto, n.puntaje, n.comites, n.resumen, n.cambios, n.comentario, acciones(n.acciones), n.accion_directorio, n.url_detalle];
}
function filaProyecto(p, seccion) {
  return [seccion, "Proyecto de ley", p.numero, p.mov_fecha || p.fecha_presentacion, p.proponente, p.titulo,
    [p.mov_comisiones, p.mov_detalle, p.ley_numero && estadoProyecto(p), recorrido(p)].filter(Boolean).join(" · "), p.sector, p.calificacion, p.impacto, p.puntaje, p.comites, p.resumen,
    p.cambios, p.comentario, acciones(p.acciones), p.accion_directorio, urlProyecto(p)];
}

export async function GET(request) {
  const u = await usuarioActual();
  if (!u) return new Response("Ingresa con tu usuario.", { status: 401 });
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const f = leerFiltrosMonitoreo(sp);
  const filas = [];
  let nombre = "reporte";
  if (sp.vista === "congreso") {
    const fecha = f.fecha || ayerLima();
    const r = await reporteCongreso(f, fecha, fecha);
    const secciones = [
      ["diputados_ingresadas", "Diputados · Proposiciones ingresadas"], ["diputados_dictamenes", "Diputados · Dictámenes"],
      ["senado_ingresadas", "Senado · Proposiciones ingresadas"], ["senado_dictamenes", "Senado · Dictámenes"],
      ["autografas", "Autógrafas de ley"], ["publicadas", "Leyes publicadas"],
    ];
    for (const [k, t] of secciones) for (const p of r[k].items) filas.push(filaProyecto(p, t));
    nombre = `congreso-${fecha}`;
  } else if (sp.vista === "impacto") {
    const per = leerPeriodo(sp);
    const [ns, ps] = await Promise.all([normasAnalizadas(f, per.desde, per.hasta), proyectosAnalizados(f, per.desde, per.hasta)]);
    ns.forEach((n) => filas.push(filaNorma(n)));
    ps.forEach((p) => filas.push(filaProyecto(p, "Proyectos de ley")));
    nombre = `impacto-${per.fecha || per.mes}`;
  } else {
    const ns = await normasAnalizadas(f, `${f.mes}-01`, finDeMes(f.mes));
    ns.forEach((n) => filas.push(filaNorma(n)));
    nombre = `normas-${f.mes}`;
  }
  const texto = "﻿" + [COLS.join(","), ...filas.map((r) => r.map(celda).join(","))].join("\r\n");
  return new Response(texto, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}.csv"`,
    },
  });
}
