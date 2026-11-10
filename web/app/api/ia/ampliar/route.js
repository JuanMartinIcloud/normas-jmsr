import { usuarioActual } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { generarJSON, ErrorIA } from "../../../../lib/gemini";
import { claveDe, buscarGuardada, guardarConsulta } from "../../../../lib/consultasIA";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ESQUEMA = {
  type: "OBJECT",
  properties: { terminos: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["terminos"],
};

const INSTRUCCIONES = `Eres un abogado peruano experto en legislación. Un usuario busca normas legales de El Peruano
y proyectos de ley del Congreso con unas palabras. Las normas se buscan por su sumilla (descripción
corta oficial), que muchas veces no usa las mismas palabras que el usuario.

Devuelve en "terminos" entre 3 y 6 expresiones de búsqueda alternativas que, en el Perú, se usan en
sumillas y títulos sobre el mismo asunto: sinónimos jurídicos, el nombre o número de la ley principal
del tema (por ejemplo "Ley 30364"), nombres de instituciones o programas, y la forma en que se redactan
las sumillas. Cada expresión de 1 a 5 palabras, en español, sin comillas ni operadores.
No repitas la búsqueda original. Responde solo con el JSON pedido.`;

export async function POST(request) {
  if (!(await usuarioActual())) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido" }, { status: 400 });
  }
  const q = String(cuerpo.q || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3) return Response.json({ error: "Escribe primero qué buscas." }, { status: 400 });

  try {
    const clave = claveDe("ampliar", q.toLowerCase());
    const guardada = await buscarGuardada(clave);
    if (guardada) return Response.json({ terminos: guardada.resultado.terminos, guardado: true });

    const { datos, modelo } = await generarJSON({
      origen: "ampliar",
      instrucciones: INSTRUCCIONES,
      partes: [{ text: `Búsqueda del usuario: ${q}` }],
      esquema: ESQUEMA,
      maxTokens: 1024,
      limiteMs: 50000,
      intentoMs: 20000,
    });
    const terminos = [];
    for (const t of datos.terminos || []) {
      const x = String(t).replace(/["|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
      if (x && x.toLowerCase() !== q.toLowerCase() && !terminos.some((y) => y.toLowerCase() === x.toLowerCase())) {
        terminos.push(x);
      }
    }
    if (!terminos.length) throw new ErrorIA("La IA no sugirió términos. Intenta con otras palabras.");
    const resultado = { terminos: terminos.slice(0, 6) };
    await guardarConsulta(clave, "ampliar", { q }, resultado, modelo);
    return Response.json({ ...resultado, guardado: false });
  } catch (e) {
    const estado = e instanceof ErrorIA ? e.estado : 500;
    return Response.json({ error: mensajeError(e) }, { status: estado });
  }
}
