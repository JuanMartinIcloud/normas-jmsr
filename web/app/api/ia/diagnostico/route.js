import { usuarioActual } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { consultar } from "../../../../lib/db";
import { pdfNorma, documentoProyecto } from "../../../../lib/documentos";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Revisa que la IA y la lectura de documentos completos funcionen desde Vercel (no gasta cupo de IA)
export async function GET() {
  const u = await usuarioActual();
  if (!u || u.rol !== "admin") return Response.json({ error: "Solo el administrador puede hacer esto." }, { status: 403 });
  const r = { clave_gemini: Boolean((process.env.GEMINI_API_KEY || "").trim()) };
  try {
    const [n] = await consultar(
      `SELECT id, fecha::text AS fecha, tipo, numero, url_detalle FROM normas
       WHERE url_detalle IS NOT NULL ORDER BY fecha DESC, id DESC LIMIT 1`
    );
    const inicio = Date.now();
    const doc = await pdfNorma(n);
    r.el_peruano = {
      norma: `${n.tipo} ${n.numero}`,
      bytes: doc ? doc.pdf.length : 0,
      segundos: (Date.now() - inicio) / 1000,
    };
  } catch (e) {
    r.el_peruano = { error: mensajeError(e) };
  }
  try {
    const [p] = await consultar(
      `SELECT id, numero, periodo, camara, num_pley FROM proyectos_ley ORDER BY fecha_presentacion DESC NULLS LAST, id DESC LIMIT 1`
    );
    const inicio = Date.now();
    const doc = await documentoProyecto(p);
    r.congreso = { proyecto: p.numero, archivo: doc.nombre, bytes: doc.pdf ? doc.pdf.length : 0, segundos: (Date.now() - inicio) / 1000 };
  } catch (e) {
    r.congreso = { error: mensajeError(e) };
  }
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
}
