import { mensajeError } from "../../../../lib/errores";
import { usuarioActual } from "../../../../lib/auth";
import { leerFiltrosMonitoreo, normasAnalizadas, proyectosAnalizados } from "../../../../lib/monitoreo";
import { generarJSON, ErrorIA } from "../../../../lib/gemini";
import { claveDe, buscarGuardada, guardarConsulta } from "../../../../lib/consultasIA";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    panorama: { type: "STRING" },
    puntos: { type: "ARRAY", items: { type: "STRING" } },
    riesgos: { type: "ARRAY", items: { type: "STRING" } },
    oportunidades: { type: "ARRAY", items: { type: "STRING" } },
    recomendaciones: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["panorama", "puntos", "riesgos", "oportunidades", "recomendaciones"],
};

const INSTRUCCIONES = `Eres el analista principal de asuntos públicos de la Cámara de Comercio Americana del Perú (AmCham).
Recibes los análisis de las normas legales y proyectos de ley del periodo que afectan al sector empresarial.
Redacta el resumen ejecutivo para el Directorio, en español claro y directo, citando los documentos por su
número cuando sea útil. Usa solo la información recibida. Responde solo con el JSON pedido:
"panorama" (3 a 5 oraciones), "puntos" (4 a 8 puntos clave), "riesgos" (lo desfavorable o incierto para el
clima de inversión), "oportunidades" (lo favorable) y "recomendaciones" (3 a 6 acciones para el Directorio).`;

export async function POST(request) {
  const inicio = Date.now();
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario." }, { status: 401 });
  const c = await request.json().catch(() => ({}));
  const F = /^\d{4}-\d{2}-\d{2}$/;
  if (!F.test(c.desde || "") || !F.test(c.hasta || "")) return Response.json({ error: "Periodo inválido." }, { status: 400 });
  try {
    const f = leerFiltrosMonitoreo({});
    const [ns, ps] = await Promise.all([normasAnalizadas(f, c.desde, c.hasta), proyectosAnalizados(f, c.desde, c.hasta)]);
    const items = [
      ...ns.map((n) => `NORMA ${[n.tipo, n.numero].filter(Boolean).join(" ")} (${n.fecha}, ${n.entidad}) | ${n.sector} | ${n.calificacion} | impacto ${n.impacto} | ${n.resumen} | Impacto: ${n.comentario}`),
      ...ps.map((p) => `PROYECTO ${p.numero} (${p.fecha_presentacion}) | ${p.sector} | ${p.calificacion} | impacto ${p.impacto} | ${p.resumen} | Impacto: ${p.comentario}`),
    ];
    if (!items.length) return Response.json({ error: "No hay documentos analizados en este periodo." }, { status: 404 });
    // Si hay demasiados, prioriza los de impacto alto y moderado
    const orden = (s) => (s.includes("impacto Alto") ? 0 : s.includes("impacto Moderado") ? 1 : 2);
    // (pedido mas liviano: hasta 150 documentos y cada uno resumido a 420 caracteres, para que la IA
    // gratuita lo acepte aun cuando esta muy solicitada)
    const usados = items.sort((a, b) => orden(a) - orden(b)).slice(0, 150).map((s) => (s.length > 420 ? `${s.slice(0, 417)}...` : s));
    const clave = claveDe("ejecutivo", { desde: c.desde, hasta: c.hasta, usados });
    if (!c.rehacer) {
      const g = await buscarGuardada(clave);
      if (g) return Response.json({ ...g.resultado, cantidad: items.length, guardado: true });
    }
    const { datos, modelo } = await generarJSON({
      origen: "resumen ejecutivo",
      instrucciones: INSTRUCCIONES,
      partes: [{ text: `Periodo: ${c.desde} a ${c.hasta}\n\n${usados.join("\n")}` }],
      esquema: ESQUEMA,
      maxTokens: 8192,
      limiteMs: Math.max(30000, 285000 - (Date.now() - inicio)),
      intentoMs: 90000,
    });
    const limpio = {
      panorama: String(datos.panorama || "").trim(),
      puntos: (datos.puntos || []).map(String),
      riesgos: (datos.riesgos || []).map(String),
      oportunidades: (datos.oportunidades || []).map(String),
      recomendaciones: (datos.recomendaciones || []).map(String),
    };
    await guardarConsulta(clave, "ejecutivo", { desde: c.desde, hasta: c.hasta }, limpio, modelo);
    return Response.json({ ...limpio, cantidad: items.length, guardado: false });
  } catch (e) {
    const estado = e instanceof ErrorIA ? e.estado : 500;
    return Response.json({ error: mensajeError(e) }, { status: estado });
  }
}
