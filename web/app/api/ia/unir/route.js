import { usuarioActual } from "../../../../lib/auth";
import { Aviso, mensajeError } from "../../../../lib/errores";
import { consultarGuardado } from "../../../../lib/db";
import { colsLey, estadoProyecto } from "../../../../lib/leyes";
import { urlProyecto } from "../../../../lib/resumenes";
import { generarJSON, partePDF, ErrorIA } from "../../../../lib/gemini";
import { pdfNorma, documentoProyecto } from "../../../../lib/documentos";
import { textoCompleto, claveProyecto } from "../../../../lib/textos";
import { claveDe, buscarGuardada, guardarConsulta } from "../../../../lib/consultasIA";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAXIMO = 6;

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    titulo: { type: "STRING" },
    resumen: { type: "STRING" },
    secciones: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { titulo: { type: "STRING" }, parrafos: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["titulo", "parrafos"],
      },
    },
    notas: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["titulo", "resumen", "secciones", "notas"],
};

const COMUN = `Eres un abogado peruano experto en técnica legislativa que trabaja para un estudio de abogados.
Escribe en español jurídico claro, preciso y sin adornos. Usa solo el contenido de los documentos
recibidos; no inventes artículos, cifras, fechas ni normas que no aparezcan en ellos. Si un documento
llegó solo con su sumilla o título (sin texto completo), tenlo en cuenta y dilo en "notas".
Responde solo con el JSON pedido: "titulo", "resumen" (2 a 4 oraciones sobre lo que hiciste),
"secciones" (cada una con "titulo" y "parrafos"; un párrafo por artículo o idea) y "notas"
(advertencias para el abogado que revisará el texto).`;

const INSTRUCCIONES = {
  unir: `${COMUN}

Tarea: UNE los documentos en un solo texto coherente y ordenado.
- Si son normas que se modifican entre sí, arma un texto consolidado: aplica las modificaciones en
  su lugar y señala en cada parte de qué documento proviene (por ejemplo, "[según D2]").
- Si tratan el mismo tema sin modificarse, organiza el contenido por materias, sin repetir lo que
  dicen igual y dejando constancia de las diferencias.
- En "notas" indica contradicciones, derogaciones, vacíos y qué documento prevalece y por qué
  (jerarquía, especialidad o fecha), cuando se pueda saber con los datos recibidos.`,
  proyecto: `${COMUN}

Tarea: a partir de los PROYECTOS DE LEY recibidos (similares o sobre el mismo tema), REDACTA UN SOLO
PROYECTO DE LEY UNIFICADO Y MEJORADO, siguiendo la técnica legislativa del Congreso del Perú.
Usa estas secciones, en este orden:
1. "Fórmula legal": título de la ley y su articulado completo (Artículo 1. Objeto, definiciones si
   hacen falta, artículos sustantivos, y Disposiciones Complementarias Finales/Transitorias/
   Modificatorias/Derogatorias cuando correspondan). Toma lo mejor de cada proyecto, elimina
   duplicidades, corrige vacíos y redacta con precisión.
2. "Exposición de motivos": problema que se busca resolver, fundamentos y propuesta, con base en lo
   que exponen los proyectos.
3. "Marco normativo": normas citadas por los proyectos.
4. "Análisis costo-beneficio".
5. "Efecto de la vigencia de la norma sobre la legislación nacional".
6. "Origen de la propuesta": qué se tomó de cada proyecto (cita D1, D2, etc. y su número).
Las normas legales que también se reciban sirven solo como contexto.`,
};

const limpiaTexto = (v) => String(v || "").trim();

export async function POST(request) {
  if (!(await usuarioActual())) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  const inicio = Date.now();
  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido" }, { status: 400 });
  }
  const accion = cuerpo.accion === "proyecto" ? "proyecto" : "unir";
  const items = [];
  for (const it of Array.isArray(cuerpo.items) ? cuerpo.items : []) {
    const t = it && (it.t === "N" || it.t === "P") ? it.t : null;
    const id = it && /^\d{1,18}$/.test(String(it.id)) ? String(it.id) : null;
    if (t && id && !items.some((x) => x.t === t && x.id === id)) items.push({ t, id });
  }
  if (items.length < 2) return Response.json({ error: "Selecciona al menos 2 documentos." }, { status: 400 });
  if (items.length > MAXIMO) return Response.json({ error: `Se pueden unir hasta ${MAXIMO} documentos a la vez.` }, { status: 400 });
  if (accion === "proyecto" && items.filter((x) => x.t === "P").length < 2) {
    return Response.json({ error: "Para proponer un proyecto unificado selecciona al menos 2 proyectos de ley." }, { status: 400 });
  }

  try {
    const idsN = items.filter((x) => x.t === "N").map((x) => x.id);
    const idsP = items.filter((x) => x.t === "P").map((x) => x.id);
    const [normas, proyectos] = await Promise.all([
      idsN.length
        ? consultarGuardado(
            `SELECT id::text AS id, fecha::text AS fecha, tipo, numero, entidad, sumilla, url_detalle, url_pdf, hash_unico
             FROM normas WHERE id = ANY($1::bigint[])`,
            [idsN]
          )
        : [],
      idsP.length
        ? consultarGuardado(
            `SELECT id::text AS id, numero, periodo, camara, num_pley, url, fecha_presentacion::text AS fecha,
                    titulo, proponente, autor, estado, sumilla, ${colsLey("proyectos_ley")}
             FROM proyectos_ley WHERE id = ANY($1::bigint[])`,
            [idsP]
          )
        : [],
    ]);
    // Mismo orden en que el usuario los selecciono
    const docs = items
      .map((it) => ({ ...it, fila: (it.t === "N" ? normas : proyectos).find((f) => f.id === it.id) }))
      .filter((d) => d.fila);
    if (docs.length < 2) return Response.json({ error: "No se encontraron los documentos seleccionados." }, { status: 404 });

    const clave = claveDe(accion, docs.map((d) => `${d.t}${d.id}`));
    const fuentesBase = docs.map((d, i) => ({
      codigo: `D${i + 1}`,
      texto: d.t === "N" ? [d.fila.tipo, d.fila.numero].filter(Boolean).join(" N° ") : `Proyecto ${d.fila.numero}`,
      url: d.t === "N" ? d.fila.url_detalle || d.fila.url_pdf : urlProyecto(d.fila),
    }));
    const guardada = cuerpo.rehacer ? null : await buscarGuardada(clave);
    if (guardada) return Response.json({ ...guardada.resultado, modelo: guardada.modelo, guardado: true });

    // Descarga en paralelo el texto completo de cada documento
    const lecturas = await Promise.all(
      docs.map(async (d) => {
        try {
          // Si el texto completo ya esta guardado se usa directamente (mas rapido que el PDF)
          const clave = d.t === "N" ? d.fila.hash_unico : claveProyecto(d.fila);
          const guardado = await textoCompleto(d.t, clave).catch(() => "");
          if (guardado) return { texto: guardado, sumilla: d.fila.sumilla };
          if (d.t === "N") {
            const doc = await pdfNorma(d.fila);
            return doc ? { pdf: doc.pdf, nombre: doc.nombre } : { aviso: "La norma no tiene PDF en El Peruano; se usó la sumilla." };
          }
          const doc = await documentoProyecto(d.fila);
          if (doc.pdf) return { pdf: doc.pdf, nombre: doc.nombre, sumilla: doc.sumilla };
          return { sumilla: doc.sumilla, aviso: "El Congreso no tiene el PDF; se usaron el título y la sumilla." };
        } catch (e) {
          const motivo = e instanceof Aviso ? ` (${e.message})` : "";
          if (!motivo) console.error(e);
          return { aviso: `No se pudo leer el texto completo${motivo}; se usó la sumilla o el título.` };
        }
      })
    );

    const partes = [
      {
        text:
          accion === "proyecto"
            ? `Se reciben ${docs.length} documentos para redactar un proyecto de ley unificado.`
            : `Se reciben ${docs.length} documentos para unir en un solo texto.`,
      },
    ];
    const fuentes = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const l = lecturas[i];
      const f = d.fila;
      const cabecera =
        d.t === "N"
          ? `DOCUMENTO D${i + 1} — NORMA LEGAL: ${[f.tipo, f.numero].filter(Boolean).join(" N° ")} | ${f.entidad || ""} | publicada ${f.fecha}\nSumilla: ${limpiaTexto(f.sumilla)}`
          : `DOCUMENTO D${i + 1} — PROYECTO DE LEY ${f.numero} | presentado ${f.fecha || ""} | ${f.proponente || ""} | autores: ${limpiaTexto(f.autor) || "-"} | estado: ${estadoProyecto(f) || "-"}\nTítulo: ${limpiaTexto(f.titulo)}${l.sumilla ? `\nSumilla: ${limpiaTexto(l.sumilla)}` : ""}`;
      partes.push({ text: cabecera });
      let lectura = "solo sumilla";
      if (l.texto) {
        partes.push({ text: `TEXTO COMPLETO DE D${i + 1}:\n${l.texto}` });
        lectura = "texto completo";
      } else if (l.pdf) {
        partes.push({ text: `PDF COMPLETO DE D${i + 1}:` });
        partes.push(await partePDF(l.pdf, l.nombre));
        lectura = "PDF completo";
      } else {
        partes.push({ text: `(D${i + 1} sin texto completo disponible)` });
      }
      fuentes.push({ ...fuentesBase[i], lectura, aviso: l.aviso || "" });
    }

    const { datos, modelo } = await generarJSON({
      origen: "unir",
      instrucciones: INSTRUCCIONES[accion],
      partes,
      esquema: ESQUEMA,
      maxTokens: 32768,
      limiteMs: Math.max(30000, 290000 - (Date.now() - inicio)),
      intentoMs: 200000,
    });
    const secciones = (datos.secciones || [])
      .map((s) => ({
        titulo: limpiaTexto(s && s.titulo),
        parrafos: ((s && s.parrafos) || []).map(limpiaTexto).filter(Boolean),
      }))
      .filter((s) => s.titulo || s.parrafos.length);
    if (!secciones.length) throw new ErrorIA("La IA devolvió un texto vacío. Intenta de nuevo.");
    const resultado = {
      accion,
      titulo: limpiaTexto(datos.titulo) || (accion === "proyecto" ? "Proyecto de ley unificado" : "Texto unificado"),
      resumen: limpiaTexto(datos.resumen),
      secciones,
      notas: (datos.notas || []).map(limpiaTexto).filter(Boolean),
      fuentes,
    };
    // Solo se guarda si se leyeron todos los textos; si alguno fallo, la proxima vez se reintenta
    if (fuentes.every((f) => f.lectura !== "solo sumilla" || !/No se pudo leer/.test(f.aviso))) {
      await guardarConsulta(clave, accion, { items }, resultado, modelo);
    }
    return Response.json({ ...resultado, modelo, guardado: false });
  } catch (e) {
    const estado = e instanceof ErrorIA ? e.estado : 500;
    return Response.json({ error: mensajeError(e) }, { status: estado });
  }
}
