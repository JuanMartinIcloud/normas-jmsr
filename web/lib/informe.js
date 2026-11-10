import { consultar } from "./db";
import { leerFiltrosMonitoreo, normasAnalizadas, reporteCongreso, fechaLarga } from "./monitoreo";
import { urlProyecto } from "./resumenes";
import { estadoProyecto, recorrido } from "./leyes";

// Informe diario: normas del dia + movimientos del Congreso del dia (lo que queda tras quitar items)

export async function datosInforme(fecha) {
  const f = leerFiltrosMonitoreo({});
  const [normas, congreso, est] = await Promise.all([
    normasAnalizadas(f, fecha, fecha),
    reporteCongreso(f, fecha, fecha),
    consultar(`SELECT estado, aprobado_por, aprobado_en::text, enviado_en::text FROM informes WHERE fecha = $1`, [fecha]),
  ]);
  return { fecha, normas, congreso, estado: est[0] || { estado: "borrador" } };
}

const SECCIONES = [
  ["diputados_ingresadas", "Cámara de Diputados · Proposiciones legislativas ingresadas"],
  ["diputados_dictamenes", "Cámara de Diputados · Dictámenes de comisiones"],
  ["senado_ingresadas", "Senado · Proposiciones legislativas ingresadas"],
  ["senado_dictamenes", "Senado · Dictámenes de comisiones"],
  ["autografas", "Autógrafas de ley"],
  ["publicadas", "Leyes publicadas (proposiciones convertidas en ley)"],
];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COLOR = { Favorable: "#1d6b35", Desfavorable: "#9b1c1c", "Para seguimiento": "#7a5a00" };

function bloque(titulo, desc, url, a, extra = "") {
  const acc = (a.acciones || []).map((x) => `<li><b>${esc(x.comite)}:</b> ${esc(x.accion)}</li>`).join("");
  return `<div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0">
  <div style="font-weight:600">${url ? `<a href="${esc(url)}">${esc(titulo)}</a>` : esc(titulo)}</div>
  <div style="color:#555;font-size:13px">${esc(desc)}</div>${extra ? `<div style="color:#555;font-size:13px">${esc(extra)}</div>` : ""}
  <div style="margin:6px 0;font-size:13px"><b style="color:${COLOR[a.calificacion] || "#333"}">${esc(a.calificacion)}</b> · Impacto ${esc(String(a.impacto).toLowerCase())}${a.puntaje ? ` (${a.puntaje}/10)` : ""} · ${esc(a.sector)} · Comités: ${esc((a.comites || []).join(", "))}</div>
  <p style="margin:4px 0"><b>En qué consiste:</b> ${esc(a.resumen)}</p>
  <p style="margin:4px 0"><b>Qué cambia:</b> ${esc(a.cambios)}</p>
  <p style="margin:4px 0"><b>Impacto empresarial:</b> ${esc(a.comentario)}</p>
  ${acc ? `<p style="margin:4px 0"><b>Acciones sugeridas:</b></p><ul style="margin:0">${acc}</ul>` : ""}
  ${a.accion_directorio && !/^ninguna/i.test(a.accion_directorio) ? `<p style="margin:4px 0"><b>Directorio:</b> ${esc(a.accion_directorio)}</p>` : ""}
</div>`;
}

// HTML del correo. Si se pasa "comite", solo incluye lo que corresponde a ese comite.
export function htmlInforme(d, comite = null) {
  const filtra = (lista) => (comite ? lista.filter((x) => (x.comites || []).includes(comite)) : lista);
  const normas = filtra(d.normas);
  let cuerpo = "";
  let total = normas.length;
  cuerpo += `<h2 style="font-size:18px;border-bottom:2px solid #8f1d2c">Normas legales publicadas (${normas.length})</h2>`;
  cuerpo += normas.length
    ? normas.map((n) => bloque(`${[n.tipo, n.numero].filter(Boolean).join(" N° ")} · ${n.entidad || ""}`, n.sumilla, n.url_detalle, n)).join("")
    : `<p style="color:#666">Sin normas con impacto empresarial.</p>`;
  cuerpo += `<h2 style="font-size:18px;border-bottom:2px solid #8f1d2c">Congreso de la República</h2>`;
  for (const [k, t] of SECCIONES) {
    const items = filtra(d.congreso[k].items);
    total += items.length;
    cuerpo += `<h3 style="font-size:15px">${esc(t)} (${items.length})</h3>`;
    cuerpo += items.length
      ? items.map((p) => bloque(`Proposición ${p.numero} · ${p.proponente || ""}`, p.titulo, urlProyecto(p), p, [p.mov_comisiones && `Comisión: ${p.mov_comisiones}`, p.mov_detalle, p.ley_numero && estadoProyecto(p), recorrido(p)].filter(Boolean).join(" · "))).join("")
      : `<p style="color:#666">Sin movimientos con impacto empresarial.</p>`;
  }
  const titulo = `Informe de monitoreo empresarial · ${fechaLarga(d.fecha)}${comite ? ` · Comité ${comite}` : ""}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:760px;color:#222">
<h1 style="font-size:20px;color:#8f1d2c">${esc(titulo)}</h1>
<p style="color:#555">Normas legales y movimientos del Congreso que afectan al sector empresarial y al clima de inversiones. Análisis preparado con IA y revisado antes de su envío.</p>
${cuerpo}
<p style="color:#888;font-size:12px">Calificación: Favorable (promueve o favorece el clima de inversión o beneficia a las empresas), Desfavorable (las perjudica) o Para seguimiento (efecto incierto o pendiente de reglamento o aprobación). Puntaje de impacto del 1 al 10: alto 8 a 10, moderado 5 a 7, bajo 1 a 4.</p></div>`;
  return { titulo, html, total };
}
