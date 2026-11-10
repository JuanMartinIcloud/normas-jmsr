import { usuarioActual } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { consultar, hoyLima } from "../../../lib/db";
import { cargarResumen, ayerLima } from "../../../lib/resumenes";
import { estadoBases } from "../../../lib/textos";

export const dynamic = "force-dynamic";

// Estado del sistema en formato JSON, para revisar rapidamente que todo este al dia (solo con sesion iniciada).
// Se consulta a pedido (nadie la llama automaticamente).
export async function GET() {
  if (!(await usuarioActual())) return Response.json({ error: "Ingresa con tu usuario." }, { status: 401 });
  const estado = { hoy: hoyLima(), ayer: ayerLima() };
  try {
    const [n] = await consultar(`SELECT count(*)::int AS total, max(fecha)::text AS ultima FROM normas`);
    estado.normas = n;
    const [p] = await consultar(`SELECT count(*)::int AS total, max(fecha_presentacion)::text AS ultimo FROM proyectos_ley`);
    estado.proyectos = p;
    estado.resumenes = await consultar(
      `SELECT fecha::text AS fecha, modelo, n_normas, n_proyectos, n_cambios, creado_en::text AS creado_en
       FROM resumenes ORDER BY fecha DESC LIMIT 7`
    );
    estado.tamano = await consultar(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS base,
              pg_size_pretty(pg_total_relation_size('normas')) AS normas,
              pg_size_pretty(pg_total_relation_size('proyectos_ley')) AS proyectos`
    );
    try {
      const [b] = await consultar(
        `SELECT (SELECT count(*)::int FROM proyectos_ley WHERE sumilla_revisada) AS proyectos_con_sumilla`
      );
      estado.busqueda = b;
    } catch (e) {
      estado.busqueda = { error: mensajeError(e) };
    }
    try {
      estado.textos = await estadoBases();
    } catch (e) {
      estado.textos = { error: mensajeError(e) };
    }
    const ultimo = await cargarResumen();
    estado.portada = ultimo ? { fecha: ultimo.fecha, referencias: Object.keys(ultimo.referencias).length } : null;
  } catch (e) {
    estado.error = mensajeError(e);
  }
  return Response.json(estado, { headers: { "Cache-Control": "no-store" } });
}
