import { Aviso, mensajeError } from "../../../../lib/errores";
import { usuarioActual, crearUsuario, cifrarClave } from "../../../../lib/auth";
import { consultar } from "../../../../lib/db";

export const dynamic = "force-dynamic";

// Solo el administrador: crear usuario, activar/desactivar, cambiar contraseña
export async function POST(request) {
  const u = await usuarioActual();
  if (!u || u.rol !== "admin") return Response.json({ error: "Solo el administrador puede hacer esto." }, { status: 403 });
  const c = await request.json().catch(() => ({}));
  try {
    if (c.accion === "crear") {
      await crearUsuario({ usuario: c.usuario, nombre: c.nombre, clave: c.clave, rol: c.rol });
    } else if (c.accion === "activo") {
      if (Number(c.id) === u.id) throw new Aviso("No puedes desactivar tu propia cuenta.");
      await consultar(`UPDATE usuarios SET activo = $2 WHERE id = $1`, [Number(c.id), Boolean(c.activo)]);
    } else if (c.accion === "clave") {
      if (String(c.clave || "").length < 8) throw new Aviso("La contraseña debe tener al menos 8 caracteres.");
      await consultar(`UPDATE usuarios SET clave_hash = $2 WHERE id = $1`, [Number(c.id), await cifrarClave(c.clave)]);
    } else {
      throw new Aviso("Acción desconocida.");
    }
    return Response.json({ ok: true });
  } catch (e) {
    const msg = /duplicate key/i.test(String(e.message)) ? "Ese usuario ya existe." : mensajeError(e);
    return Response.json({ error: msg }, { status: 400 });
  }
}
