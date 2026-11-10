import { usuarioActual } from "../../../../lib/auth";
import { marcarExcluido } from "../../../../lib/monitoreo";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario." }, { status: 401 });
  const c = await request.json().catch(() => ({}));
  if (!c.id) return Response.json({ error: "Falta el ítem." }, { status: 400 });
  await marcarExcluido(c.id, Boolean(c.excluir), u.nombre || u.usuario);
  return Response.json({ ok: true });
}
