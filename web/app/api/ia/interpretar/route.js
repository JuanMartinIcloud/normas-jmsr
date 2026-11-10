import { usuarioActual } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { generarJSON, ErrorIA } from "../../../../lib/gemini";
import { claveDe, buscarGuardada, guardarConsulta } from "../../../../lib/consultasIA";
import { hoyLima } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Convierte una pregunta en lenguaje natural en una busqueda: expresiones clave y, si la
// pregunta lo dice, un rango de fechas.
const ESQUEMA = {
  type: "OBJECT",
  properties: {
    terminos: { type: "ARRAY", items: { type: "STRING" } },
    desde: { type: "STRING" },
    hasta: { type: "STRING" },
  },
  required: ["terminos", "desde", "hasta"],
};

function instrucciones(hoy) {
  return `Eres un abogado peruano experto en legislación. Un usuario escribe en lenguaje natural lo que
quiere encontrar entre las normas legales publicadas en El Peruano (desde 2015) y los proyectos de ley
del Congreso. El buscador encuentra documentos por palabras de su sumilla, título o texto.

Convierte el pedido en una búsqueda:
- "terminos": entre 4 y 8 expresiones de búsqueda de 1 a 4 palabras cada una, tal como aparecerían en
  sumillas y títulos peruanos sobre lo pedido: los conceptos centrales, sus sinónimos jurídicos, nombres
  de leyes, programas o instituciones del tema. Basta que un documento contenga una de ellas.
  No uses palabras genéricas que aparecen en casi todo ("normas", "ley", "decreto", "sector", "Perú",
  "peruano", "disposiciones", "aprueban", "afecten"). Sin comillas ni operadores.
- "desde" y "hasta": fechas AAAA-MM-DD solo si el pedido indica un periodo (por ejemplo "este año",
  "en 2023", "últimos 6 meses"); si no, cadena vacía. Hoy es ${hoy}.
Responde solo con el JSON pedido.`;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request) {
  if (!(await usuarioActual())) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido" }, { status: 400 });
  }
  const q = String(cuerpo.q || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (q.length < 3) return Response.json({ error: "Escribe primero qué buscas." }, { status: 400 });
  const hoy = hoyLima();

  try {
    const clave = claveDe("interpretar", `${q.toLowerCase()}|${hoy.slice(0, 7)}`);
    const guardada = await buscarGuardada(clave);
    if (guardada) return Response.json({ ...guardada.resultado, guardado: true });

    const { datos, modelo } = await generarJSON({
      origen: "buscar con IA",
      instrucciones: instrucciones(hoy),
      partes: [{ text: `Pedido del usuario: ${q}` }],
      esquema: ESQUEMA,
      maxTokens: 1024,
      limiteMs: 50000,
      intentoMs: 20000,
    });
    const terminos = [];
    for (const t of datos.terminos || []) {
      const x = String(t).replace(/["|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
      if (x && !terminos.some((y) => y.toLowerCase() === x.toLowerCase())) terminos.push(x);
    }
    if (!terminos.length) throw new ErrorIA("La IA no pudo interpretar la búsqueda. Intenta con otras palabras.");
    const desde = FECHA.test(datos.desde || "") ? datos.desde : "";
    const hasta = FECHA.test(datos.hasta || "") ? datos.hasta : "";
    const resultado = { terminos: terminos.slice(0, 8), desde, hasta };
    await guardarConsulta(clave, "interpretar", { q }, resultado, modelo);
    return Response.json({ ...resultado, guardado: false });
  } catch (e) {
    const estado = e instanceof ErrorIA ? e.estado : 500;
    return Response.json({ error: mensajeError(e) }, { status: estado });
  }
}
