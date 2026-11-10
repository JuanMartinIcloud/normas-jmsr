import {
  AlignmentType, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell,
  TableRow, TextRun, WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { usuarioActual } from "../../../../lib/auth";
import { leerFiltrosMonitoreo, normasAnalizadas, proyectosAnalizados } from "../../../../lib/monitoreo";
import { leerPeriodo } from "../../../../lib/periodo";
import { urlProyecto } from "../../../../lib/resumenes";
import { estadoProyecto } from "../../../../lib/leyes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Documentos de impacto alto" del resumen ejecutivo, en Word (?formato=word) o en Excel (?formato=excel).
// Mismo periodo (?mes= o ?fecha=) y mismos documentos que la tabla de la pantalla.

const CAMARA_NOMBRE = { D: "Cámara de Diputados", S: "Senado", C: "Congreso (unicameral)" };
// Camara del proyecto y quien lo propuso (sin repetir la camara cuando la propuesta es de sus propios congresistas)
const simple = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function origenProyecto(x) {
  const camara = CAMARA_NOMBRE[x.camara] || x.camara || "";
  const prop = x.proponente || "";
  const propio = !prop || simple(prop) === simple(camara) || /^(congreso|camara de diputados|senado)/.test(simple(prop));
  return propio ? `${camara} · Propuesto por congresistas` : `${camara} · Propuesto por: ${prop}`;
}


const COLUMNAS = [
  { titulo: "Documento", ancho: 15 },
  { titulo: "Tipo", ancho: 8 },
  { titulo: "Emisor u origen", ancho: 13 },
  { titulo: "Estado", ancho: 11 },
  { titulo: "Puntaje", ancho: 6 },
  { titulo: "Sector", ancho: 11 },
  { titulo: "Calificación", ancho: 11 },
  { titulo: "En qué consiste", ancho: 22 },
  { titulo: "Cambios", ancho: 21 },
];

async function documentos(sp) {
  const per = leerPeriodo(sp);
  const f = leerFiltrosMonitoreo({});
  const [normas, proyectos] = await Promise.all([normasAnalizadas(f, per.desde, per.hasta), proyectosAnalizados(f, per.desde, per.hasta)]);
  const todos = [...normas.map((n) => ({ ...n, origen: "N" })), ...proyectos.map((p) => ({ ...p, origen: "P" }))];
  const filas = todos
    .filter((x) => x.impacto === "Alto")
    .sort((a, b) => (b.puntaje || 0) - (a.puntaje || 0))
    .map((x) => ({
      documento: x.origen === "N" ? [x.tipo, x.numero].filter(Boolean).join(" N° ") : `Proposición ${x.numero}`,
      tipo: x.origen === "N" ? "Norma legal" : "Proyecto de ley",
      origen: x.origen === "N" ? x.entidad || ""
        : origenProyecto(x),
      estado: x.origen === "N" ? `Publicada en El Peruano (${x.fecha})` : estadoProyecto(x),
      puntaje: x.puntaje ? `${x.puntaje}/10` : "",
      sector: x.sector || "",
      calificacion: x.calificacion || "",
      consiste: x.resumen || "",
      cambios: x.cambios || "",
      enlace: (x.origen === "N" ? x.url_detalle : urlProyecto(x)) || "",
    }));
  return { per, filas };
}

const valores = (r) => [r.documento, r.tipo, r.origen, r.estado, r.puntaje, r.sector, r.calificacion, r.consiste, r.cambios];

async function word(per, filas) {
  const total = COLUMNAS.reduce((s, c) => s + c.ancho, 0);
  const celda = (texto, cabecera, ancho) =>
    new TableCell({
      width: { size: Math.round((ancho / total) * 100), type: WidthType.PERCENTAGE },
      shading: cabecera ? { type: ShadingType.CLEAR, fill: "8F1D2C", color: "auto" } : undefined,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({ children: [new TextRun({ text: String(texto || ""), bold: cabecera, color: cabecera ? "FFFFFF" : undefined, size: 17 })] })],
    });
  const tabla = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: COLUMNAS.map((c) => celda(c.titulo, true, c.ancho)) }),
      ...filas.map((r) => new TableRow({ children: valores(r).map((v, i) => celda(v, false, COLUMNAS[i].ancho)) })),
    ],
  });
  const normas = filas.filter((r) => r.tipo === "Norma legal").length;
  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: [
        new Paragraph({ text: `Documentos de impacto alto · ${per.nombre}`, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          spacing: { after: 160 },
          children: [new TextRun({ text: `${filas.length} documentos: ${normas} normas legales y ${filas.length - normas} proyectos de ley, del mayor al menor puntaje de impacto (8 a 10).`, color: "555555" })],
        }),
        filas.length ? tabla : new Paragraph({ text: "No hay documentos de impacto alto en este periodo." }),
        new Paragraph({
          spacing: { before: 200 },
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: "Análisis elaborado con inteligencia artificial. Monitoreo empresarial.", italics: true, size: 16, color: "777777" })],
        }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function excel(per, filas) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Impacto alto", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = [
    ...COLUMNAS.map((c) => ({ header: c.titulo, width: Math.round(c.ancho * 2.4) })),
    { header: "Enlace", width: 40 },
  ];
  for (const r of filas) hoja.addRow([...valores(r), r.enlace]);
  const cab = hoja.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8F1D2C" } };
  hoja.eachRow((fila) => {
    fila.alignment = { vertical: "top", wrapText: true };
  });
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length + 1 } };
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export async function GET(request) {
  const u = await usuarioActual();
  if (!u) return new Response("Ingresa con tu usuario.", { status: 401 });
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const { per, filas } = await documentos(sp);
  const nombre = `impacto-alto-${per.fecha || per.mes}`;
  if (sp.formato === "excel") {
    return new Response(await excel(per, filas), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
      },
    });
  }
  return new Response(await word(per, filas), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${nombre}.docx"`,
    },
  });
}
