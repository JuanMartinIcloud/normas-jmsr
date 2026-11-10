import { usuarioActual } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { excelEnFlujo, ultimaDescarga } from "../../../lib/excel";
import { hoyLima } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/excel?tipo=todo | cambios  (cambios: desde la ultima descarga de este usuario; si no hay, todo)
export async function GET(request) {
  const u = await usuarioActual();
  if (!u) return new Response("Ingresa con tu usuario.", { status: 401 });
  try {
    const pide = new URL(request.url).searchParams.get("tipo") === "cambios" ? "cambios" : "todo";
    const anterior = pide === "cambios" ? await ultimaDescarga(u.id) : null;
    const completa = !anterior;
    const nombre = `normas-jmsr-${completa ? "todo" : "cambios"}-${hoyLima()}.xlsx`;
    return new Response(excelEnFlujo({ usuarioId: u.id, completa, desde: anterior?.hasta }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(mensajeError(e), { status: 500 });
  }
}
