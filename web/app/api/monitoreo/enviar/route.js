import { Aviso, mensajeError } from "../../../../lib/errores";
import { usuarioActual } from "../../../../lib/auth";
import { consultar } from "../../../../lib/db";
import { datosInforme, htmlInforme } from "../../../../lib/informe";
import { correoConfigurado, leerDestinatarios, guardarDestinatarios, listaCorreos, enviarCorreo } from "../../../../lib/correo";
import { COMITES } from "../../../../lib/monitoreo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { accion: "aprobar" | "reabrir" | "enviar" | "destinatarios", fecha, general, comites }
export async function POST(request) {
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario." }, { status: 401 });
  const c = await request.json().catch(() => ({}));
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || "") ? c.fecha : null;
  const quien = u.nombre || u.usuario;
  try {
    if (c.accion === "destinatarios") {
      if (u.rol !== "admin") throw new Aviso("Solo el administrador cambia los destinatarios.");
      const comites = {};
      for (const k of COMITES) {
        const l = listaCorreos(c.comites?.[k]);
        if (l.length) comites[k] = l;
      }
      await guardarDestinatarios({ general: listaCorreos(c.general), comites });
      return Response.json({ ok: true });
    }
    if (!fecha) throw new Aviso("Falta la fecha del informe.");
    if (c.accion === "aprobar" || c.accion === "reabrir") {
      const aprobar = c.accion === "aprobar";
      await consultar(
        `INSERT INTO informes (fecha, estado, aprobado_por, aprobado_en) VALUES ($1, $2, $3, CASE WHEN $2 = 'aprobado' THEN now() END)
         ON CONFLICT (fecha) DO UPDATE SET estado = EXCLUDED.estado, aprobado_por = EXCLUDED.aprobado_por,
           aprobado_en = EXCLUDED.aprobado_en, actualizado = now()`,
        [fecha, aprobar ? "aprobado" : "borrador", aprobar ? quien : null]
      );
      return Response.json({ ok: true });
    }
    if (c.accion === "enviar") {
      if (!correoConfigurado()) throw new Aviso("El correo todavía no está configurado.");
      const [inf] = await consultar(`SELECT estado FROM informes WHERE fecha = $1`, [fecha]);
      if (!inf || inf.estado === "borrador") throw new Aviso("Primero aprueba el informe.");
      const dest = await leerDestinatarios();
      const d = await datosInforme(fecha);
      const enviados = [];
      if (dest.general.length) {
        const g = htmlInforme(d);
        await enviarCorreo({ para: dest.general, asunto: g.titulo, html: g.html });
        enviados.push(`General (${dest.general.length})`);
      }
      for (const [comite, correos] of Object.entries(dest.comites)) {
        const x = htmlInforme(d, comite);
        if (!x.total) continue; // el comite no tiene nada ese dia
        await enviarCorreo({ para: correos, asunto: x.titulo, html: x.html });
        enviados.push(`${comite} (${correos.length})`);
      }
      if (!enviados.length) throw new Aviso("No hay destinatarios con contenido para este informe.");
      await consultar(`UPDATE informes SET estado = 'enviado', enviado_en = now(), actualizado = now() WHERE fecha = $1`, [fecha]);
      return Response.json({ ok: true, enviados });
    }
    throw new Aviso("Acción desconocida.");
  } catch (e) {
    return Response.json({ error: mensajeError(e) }, { status: 400 });
  }
}
