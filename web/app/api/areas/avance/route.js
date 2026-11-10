import { usuarioActual } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { avancePedido } from "../../../../lib/areas";

export const dynamic = "force-dynamic";

// Avance de un pedido «Revisar este mes»: GET ?id=  ->  { estado, total, hechos, restante }
export async function GET(request) {
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  try {
    const p = await avancePedido(new URL(request.url).searchParams.get("id"));
    if (!p) return Response.json({ error: "No existe ese pedido." }, { status: 404 });
    return Response.json(p);
  } catch (e) {
    return Response.json({ error: mensajeError(e) }, { status: 500 });
  }
}
