import { Aviso, mensajeError } from "../../../lib/errores";
import { usuarioActual } from "../../../lib/auth";
import { consultar } from "../../../lib/db";
import { asegurarTablas, ejecutar, periodoDe, FRECUENCIAS, claveTareas } from "../../../lib/busquedas";
import { listaCorreos } from "../../../lib/correo";
import { lanzarAnalisis } from "../../../lib/pedidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const lista = (v) =>
  (Array.isArray(v) ? v : String(v || "").split("|"))
    .map((x) => String(x).replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8);

// POST { accion: crear | editar | activa | eliminar | ejecutar, ... }
export async function POST(request) {
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario para guardar búsquedas.", ingresar: true }, { status: 401 });
  const c = await request.json().catch(() => ({}));
  try {
    await asegurarTablas();
    const frecuencia = Object.keys(FRECUENCIAS).includes(c.frecuencia) ? c.frecuencia : "diaria";
    if (c.accion === "crear") {
      const nombre = String(c.nombre || "").trim().slice(0, 120);
      const pregunta = String(c.pregunta || "").trim().slice(0, 300);
      const q = String(c.q || "").trim().slice(0, 200);
      const terminos = lista(c.terminos);
      if (!nombre) throw new Aviso("Ponle un nombre a la búsqueda.");
      if (!q && !terminos.length) throw new Aviso("La búsqueda no tiene términos.");
      const [f] = await consultar(
        `INSERT INTO busquedas_guardadas (nombre, pregunta, q, terminos, refinar, frecuencia, con_resumen, destinatarios, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [nombre, pregunta || null, q || null, terminos, lista(c.refinar), frecuencia, c.con_resumen !== false,
          listaCorreos(c.destinatarios), u.nombre || u.usuario]
      );
      await claveTareas(); // la tarea automatica la necesita para ejecutar las busquedas
      return Response.json({ ok: true, id: f.id });
    }
    const id = Number(c.id);
    if (!id) throw new Aviso("Falta la búsqueda.");
    if (c.accion === "editar") {
      await consultar(
        `UPDATE busquedas_guardadas SET nombre = $2, frecuencia = $3, destinatarios = $4, con_resumen = $5 WHERE id = $1`,
        [id, String(c.nombre || "").trim().slice(0, 120) || "Búsqueda", frecuencia, listaCorreos(c.destinatarios), c.con_resumen !== false]
      );
    } else if (c.accion === "activa") {
      await consultar(`UPDATE busquedas_guardadas SET activa = $2 WHERE id = $1`, [id, Boolean(c.activa)]);
    } else if (c.accion === "eliminar") {
      await consultar(`DELETE FROM busquedas_guardadas WHERE id = $1`, [id]);
    } else if (c.accion === "ejecutar") {
      const [b] = await consultar(`SELECT * FROM busquedas_guardadas WHERE id = $1`, [id]);
      if (!b) throw new Aviso("La búsqueda no existe.");
      const per = periodoDe(b.frecuencia, undefined, true);
      const r = await ejecutar(b, per.desde, per.hasta);
      if (r.pedidos) await lanzarAnalisis();
      return Response.json({ ok: true, total_normas: r.total_normas, total_proyectos: r.total_proyectos });
    } else {
      throw new Aviso("Acción desconocida.");
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: mensajeError(e) }, { status: 400 });
  }
}
