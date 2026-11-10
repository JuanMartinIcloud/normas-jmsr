import { usuarioActual } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { consultarGuardado, leerFiltros, construirWhere, hoyLima, prepararBusqueda } from "../../../lib/db";

export const dynamic = "force-dynamic";

const LIMITE = 5000; // maximo de filas por descarga (las mas recientes)
const COLUMNAS = ["fecha", "tipo", "numero", "entidad", "sector", "rubro", "sumilla", "url_pdf", "url_detalle", "extraordinaria"];

function celda(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\r?\n/g, " ");
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request) {
  if (!(await usuarioActual())) return new Response("Ingresa con tu usuario para descargar.", { status: 401 });
  const url = new URL(request.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  if (sp.fecha === "hoy") sp.fecha = hoyLima();
  try {
    const f = leerFiltros(sp);
    await prepararBusqueda(f, "N");
    const { where, params } = construirWhere(f);
    const filas = await consultarGuardado(
      `SELECT fecha::text AS fecha, tipo, numero, entidad, sector, rubro, sumilla, url_pdf, url_detalle, extraordinaria
       FROM normas ${where} ORDER BY fecha DESC, id DESC LIMIT ${LIMITE}`,
      params
    );
    // Encabezados en castellano para quien abre el archivo en Excel
    const TITULOS = ["Fecha", "Tipo", "Número", "Entidad", "Sector", "Rubro", "Sumilla", "Enlace al PDF", "Enlace en El Peruano", "Edición extraordinaria"];
    const lineas = [TITULOS.join(",")];
    for (const r of filas) {
      lineas.push(COLUMNAS.map((c) => celda(c === "extraordinaria" ? (r[c] ? "Sí" : "No") : r[c])).join(","));
    }
    // BOM para que Excel abra bien las tildes
    const cuerpo = "﻿" + lineas.join("\r\n");
    return new Response(cuerpo, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="normas-legales.csv"',
      },
    });
  } catch (e) {
    return new Response(mensajeError(e), { status: 500 });
  }
}
