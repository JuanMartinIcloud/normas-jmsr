import { usuarioActual } from "../../../../lib/auth";
import { mensajeError, Aviso } from "../../../../lib/errores";
import { anotarPedidos, lanzarAnalisis, pasarAImpacto, quitarDeImpacto } from "../../../../lib/pedidos";

export const dynamic = "force-dynamic";

// POST { accion: "mes", mes: "AAAA-MM" }                      -> la IA revisa todo ese mes
//      { accion: "pasar" | "quitar", tipo: "N" | "P", id }    -> pasar a / quitar de impacto empresarial
export async function POST(request) {
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  const c = await request.json().catch(() => ({}));
  const quien = u.nombre || u.usuario;
  try {
    if (c.accion === "mes") {
      if (!/^\d{4}-\d{2}$/.test(String(c.mes || ""))) throw new Aviso("Mes inválido.");
      await anotarPedidos([{ tipo: "M", ref: c.mes }], quien);
      return Response.json({ ok: true, alMomento: await lanzarAnalisis() });
    }
    if (!/^[NP]$/.test(String(c.tipo || "")) || !/^\d{1,18}$/.test(String(c.id || ""))) throw new Aviso("Documento inválido.");
    if (c.accion === "pasar") {
      const r = await pasarAImpacto(c.tipo, String(c.id), quien);
      return Response.json({ ok: true, estado: r, alMomento: r === "pedido" ? await lanzarAnalisis() : true });
    }
    if (c.accion === "quitar") {
      await quitarDeImpacto(c.tipo, String(c.id), quien);
      return Response.json({ ok: true });
    }
    throw new Aviso("Acción desconocida.");
  } catch (e) {
    return Response.json({ error: mensajeError(e) }, { status: 400 });
  }
}
