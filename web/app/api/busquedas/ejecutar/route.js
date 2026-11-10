import { timingSafeEqual } from "node:crypto";
import { consultar } from "../../../../lib/db";
import { asegurarTablas, ejecutar, periodoDe, claveTareas, htmlEjecucion } from "../../../../lib/busquedas";
import { correoConfigurado, enviarCorreo } from "../../../../lib/correo";
import { lanzarAnalisis } from "../../../../lib/pedidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Lo llama la tarea automatica cada madrugada: ejecuta las busquedas guardadas a las que hoy les toca.
// Si no alcanza el tiempo, responde "pendientes" y la tarea vuelve a llamar.
export async function POST(request) {
  const clave = request.headers.get("x-clave-tareas") || "";
  // Sin clave (o con una de otro largo) se rechaza sin consultar la base; la comparacion es de tiempo constante
  if (!/^[0-9a-f]{48}$/.test(clave)) return Response.json({ error: "No autorizado" }, { status: 401 });
  const buena = Buffer.from(await claveTareas());
  if (buena.length !== 48 || !timingSafeEqual(buena, Buffer.from(clave))) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  await asegurarTablas();
  const inicio = Date.now();
  const sitio = new URL(request.url).origin;
  const activas = await consultar(`SELECT * FROM busquedas_guardadas WHERE activa ORDER BY id`);
  const hechas = [];
  let pendientes = 0;
  let pedidosIA = 0;
  for (const b of activas) {
    const per = periodoDe(b.frecuencia);
    if (!per) continue;
    const ya = await consultar(`SELECT 1 FROM busqueda_ejecuciones WHERE busqueda_id = $1 AND desde = $2 AND hasta = $3`, [b.id, per.desde, per.hasta]);
    if (ya.length) continue;
    if (Date.now() - inicio > 200000) {
      pendientes++;
      continue;
    }
    const r = await ejecutar(b, per.desde, per.hasta);
    let enviado = false;
    if (b.destinatarios?.length && correoConfigurado()) {
      try {
        await enviarCorreo({ para: b.destinatarios, asunto: `${b.nombre} · ${per.desde} a ${per.hasta}`, html: htmlEjecucion(b, r, sitio) });
        await consultar(`UPDATE busqueda_ejecuciones SET enviado = TRUE WHERE id = $1`, [r.id]);
        enviado = true;
      } catch (e) {
        enviado = false;
      }
    }
    hechas.push({ id: b.id, nombre: b.nombre, normas: r.total_normas, proyectos: r.total_proyectos, enviado });
    pedidosIA += r.pedidos || 0;
  }
  // Lo que la IA aun no habia revisado se analiza al momento (o en la madrugada si no hay clave de GitHub)
  if (pedidosIA) await lanzarAnalisis();
  return Response.json({ hechas, pendientes });
}
