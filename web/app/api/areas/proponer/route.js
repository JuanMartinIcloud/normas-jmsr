import { usuarioActual } from "../../../../lib/auth";
import { mensajeError, Aviso } from "../../../../lib/errores";
import { generarJSON } from "../../../../lib/gemini";
import { consultar } from "../../../../lib/db";
import { agregarArea, anotarSinonimo } from "../../../../lib/areas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// «Otra área»: la IA compara lo que escribio el usuario con las areas que ya existen.
// - Si ya existe una equivalente (aunque tenga otro nombre), la devuelve en vez de crear otra.
// - Si es nueva, le da un nombre uniforme y una descripcion, y la agrega a la lista para todos.
// POST { texto }  ->  { existente: { id, nombre } }  |  { nueva: { id, nombre, descripcion } }
const ESQUEMA = {
  type: "OBJECT",
  properties: {
    equivalente: { type: "INTEGER" },
    nombre: { type: "STRING" },
    descripcion: { type: "STRING" },
    valida: { type: "BOOLEAN" },
  },
  required: ["equivalente", "nombre", "descripcion", "valida"],
};

const INSTRUCCIONES = `Eres documentalista jurídico en el Perú. Un sistema clasifica normas legales y proyectos de ley por
ÁREAS temáticas. Un usuario pide monitorear un área escrita con sus palabras. Recibes la LISTA de áreas que
ya existen (número, nombre y lo que abarca).

Responde solo con el JSON pedido:
- "valida": false si lo pedido no es un área temática del derecho, la economía o la actividad pública
  (por ejemplo, un texto sin sentido o un insulto); true si lo es.
- "equivalente": el número del área existente que cubre lo mismo o casi lo mismo (sinónimo, plural,
  abreviatura, nombre de la entidad que la regula, o un tema que ya está dentro de esa área); 0 si
  ninguna lo cubre de verdad. Si lo pedido es una parte específica de un área existente pero el usuario
  claramente quiere seguir solo esa parte (por ejemplo "minería ilegal" frente a "Minería"), responde 0.
- "nombre": si es nueva, un nombre corto y uniforme (2 a 6 palabras, con mayúscula inicial y tildes
  correctas, como los de la lista); si existe, el nombre de esa área.
- "descripcion": si es nueva, una oración que diga qué temas abarca (como las de la lista); si existe,
  cadena vacía.`;

export async function POST(request) {
  const u = await usuarioActual();
  if (!u) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  try {
    const c = await request.json().catch(() => ({}));
    const texto = String(c.texto || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (texto.length < 3) throw new Aviso("Escribe el área que quieres monitorear.");
    const areas = await consultar(`SELECT id, nombre, descripcion, sinonimos FROM areas WHERE activa ORDER BY id`);
    // Coincidencia exacta con un nombre o un sinonimo ya conocido: no hace falta consultar a la IA
    const simple = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const igual = areas.find((a) => simple(a.nombre) === simple(texto) || (a.sinonimos || []).some((s) => simple(s) === simple(texto)));
    if (igual) return Response.json({ existente: { id: igual.id, nombre: igual.nombre } });
    const lista = areas.map((a, i) => `${i + 1}. ${a.nombre}: ${a.descripcion}${a.sinonimos?.length ? ` (también pedida como: ${a.sinonimos.join(", ")})` : ""}`).join("\n");
    const { datos } = await generarJSON({
      instrucciones: INSTRUCCIONES,
      partes: [{ text: `LISTA DE ÁREAS:\n${lista}\n\nÁREA PEDIDA POR EL USUARIO: ${texto}` }],
      esquema: ESQUEMA,
      maxTokens: 1024,
      origen: "areas-proponer",
    });
    if (datos.valida === false) throw new Aviso("Eso no parece un área temática. Escríbela de otra forma (por ejemplo: «minería ilegal», «energías renovables»).");
    const n = Number(datos.equivalente) || 0;
    if (n >= 1 && n <= areas.length) {
      const a = areas[n - 1];
      await anotarSinonimo(a.id, texto);
      return Response.json({ existente: { id: a.id, nombre: a.nombre } });
    }
    const nombre = String(datos.nombre || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const descripcion = String(datos.descripcion || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (nombre.length < 3 || descripcion.length < 10) throw new Aviso("No se pudo preparar el área. Intenta de nuevo.");
    const yaExiste = areas.find((a) => simple(a.nombre) === simple(nombre));
    if (yaExiste) return Response.json({ existente: { id: yaExiste.id, nombre: yaExiste.nombre } });
    const id = await agregarArea(nombre, descripcion, u.nombre || u.usuario, texto);
    return Response.json({ nueva: { id, nombre, descripcion } });
  } catch (e) {
    return Response.json({ error: mensajeError(e) }, { status: e instanceof Aviso ? 400 : 500 });
  }
}
