import { usuarioActual } from "../../../lib/auth";
import { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } from "docx";

export const dynamic = "force-dynamic";

const texto = (v, max = 20000) => String(v || "").slice(0, max);

// Convierte un texto generado por la IA en un archivo de Word (.docx)
export async function POST(request) {
  if (!(await usuarioActual())) return new Response("Ingresa con tu usuario.", { status: 401 });
  let d;
  try {
    d = await request.json();
  } catch {
    return new Response("Pedido inválido", { status: 400 });
  }
  const hijos = [
    new Paragraph({ text: texto(d.titulo, 500) || "Documento", heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
  ];
  if (d.resumen) hijos.push(new Paragraph({ children: [new TextRun({ text: texto(d.resumen), italics: true })] }));
  for (const s of Array.isArray(d.secciones) ? d.secciones.slice(0, 200) : []) {
    if (s && s.titulo) hijos.push(new Paragraph({ text: texto(s.titulo, 500), heading: HeadingLevel.HEADING_1 }));
    for (const p of (s && Array.isArray(s.parrafos) ? s.parrafos : []).slice(0, 2000)) {
      hijos.push(new Paragraph({ text: texto(p), spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED }));
    }
  }
  if (Array.isArray(d.notas) && d.notas.length) {
    hijos.push(new Paragraph({ text: "Notas para la revisión", heading: HeadingLevel.HEADING_1 }));
    for (const n of d.notas.slice(0, 200)) hijos.push(new Paragraph({ text: texto(n), bullet: { level: 0 } }));
  }
  if (Array.isArray(d.fuentes) && d.fuentes.length) {
    hijos.push(new Paragraph({ text: "Documentos de origen", heading: HeadingLevel.HEADING_1 }));
    for (const f of d.fuentes.slice(0, 20)) {
      hijos.push(new Paragraph({ text: `${texto(f.codigo, 10)}: ${texto(f.texto, 300)} (${texto(f.lectura, 40)})`, bullet: { level: 0 } }));
    }
  }
  hijos.push(
    new Paragraph({
      children: [new TextRun({ text: "Borrador elaborado con inteligencia artificial. Debe ser revisado por un abogado antes de usarse.", italics: true, size: 18 })],
    })
  );

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [{ children: hijos }],
  });
  const buffer = await Packer.toBuffer(doc);
  const nombre = (texto(d.titulo, 80) || "documento").replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-") || "documento";
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="documento.docx"; filename*=UTF-8''${encodeURIComponent(nombre)}.docx`,
    },
  });
}
