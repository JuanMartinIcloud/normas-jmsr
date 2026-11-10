import { headers } from "next/headers";
import { mensajeError } from "../../../lib/errores";
import { verificarUsuario, iniciarSesion, cerrarSesion, bloqueado, anotarFallo, limpiarFallos } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// POST { accion: "ingresar" | "salir", usuario, clave }
// Limite de intentos: tras 10 contraseñas equivocadas en 15 minutos (desde la misma conexion o para el
// mismo usuario) se rechazan los intentos hasta que pasen los 15 minutos.
export async function POST(request) {
  let c;
  try {
    c = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido" }, { status: 400 });
  }
  try {
    if (c.accion === "salir") {
      await cerrarSesion();
      return Response.json({ ok: true });
    }
    if (c.accion !== "ingresar") return Response.json({ error: "Pedido inválido" }, { status: 400 });
    const usuario = String(c.usuario || "").trim().toLowerCase().slice(0, 60);
    const h = await headers();
    const ip = (h.get("x-real-ip") || h.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60) || "desconocida";
    const claves = [`ip:${ip}`, `usuario:${usuario}`];
    if (await bloqueado(claves)) {
      return Response.json({ error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." }, { status: 429 });
    }
    const u = await verificarUsuario(usuario, String(c.clave || "").slice(0, 200));
    if (!u) {
      await anotarFallo(claves);
      return Response.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
    }
    await limpiarFallos(claves);
    await iniciarSesion(u);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: mensajeError(e) }, { status: 400 });
  }
}
