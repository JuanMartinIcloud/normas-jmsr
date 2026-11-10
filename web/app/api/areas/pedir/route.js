import { usuarioActual } from "../../../../lib/auth";
import { mensajeError, Aviso } from "../../../../lib/errores";
import { crearPedido, lanzarTarea } from "../../../../lib/areas";

export const dynamic = "force-dynamic";

// «Revisar este mes»: POST { area, mes: "AAAA-MM" } -> { pedido: { id, estimado_min, ... }, alMomento }
export async function POST(request) {
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  try {
    const c = await request.json().catch(() => ({}));
    const pedido = await crearPedido(c.area, String(c.mes || ""), u.nombre || u.usuario);
    const alMomento = pedido.estado === "pendiente" ? await lanzarTarea() : true;
    return Response.json({ pedido, alMomento });
  } catch (e) {
    return Response.json({ error: mensajeError(e) }, { status: e instanceof Aviso ? 400 : 500 });
  }
}
