import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { consultar } from "./db";

// Descarga en Excel de todo lo que guarda el sistema: normas legales, proyectos de ley y su seguimiento.
// La primera vez trae todo. Las siguientes, «solo los cambios»: lo nuevo y lo que cambio desde la ultima
// descarga de ese usuario (cada descarga completa queda anotada en excel_descargas).

const LOTE = 10000;

const HOJAS = {
  normas: {
    nombre: "Normas legales",
    columnas: [
      ["Cambio", 12], ["Fecha", 12], ["Tipo", 26], ["Número", 24], ["Entidad", 34], ["Sector", 22], ["Rubro", 22],
      ["Sumilla", 90], ["Extraordinaria", 14], ["Enlace", 12], ["PDF", 10],
    ],
    sql: (filtro) => `SELECT id, (creado_en > $1::timestamptz) AS nuevo, to_char(fecha, 'YYYY-MM-DD') AS fecha, tipo, numero,
                             entidad, sector, rubro, sumilla, extraordinaria, url_detalle, url_pdf
                      FROM normas WHERE id > $3 AND ${filtro} ORDER BY id LIMIT ${LOTE}`,
    fila: (r) => [r.nuevo ? "Nuevo" : "Modificado", r.fecha, r.tipo, r.numero, r.entidad, r.sector, r.rubro, r.sumilla,
      r.extraordinaria ? "Sí" : "No", enlace(r.url_detalle, "Ver norma"), enlace(r.url_pdf, "PDF")],
  },
  proyectos: {
    nombre: "Proyectos de ley",
    columnas: [
      ["Cambio", 12], ["Periodo", 10], ["Cámara", 12], ["Número", 18], ["Presentado", 12], ["Título", 80],
      ["Sumilla", 80], ["Autor", 30], ["Proponente", 24], ["Estado", 30], ["Rubro", 22], ["Ley", 22],
      ["Fecha de la ley", 14], ["Enlace", 14],
    ],
    sql: (filtro) => `SELECT id, (creado_en > $1::timestamptz) AS nuevo, periodo, camara, numero,
                             to_char(fecha_presentacion, 'YYYY-MM-DD') AS presentado, titulo, sumilla, autor, proponente,
                             estado, rubro, ley_tipo, ley_numero, to_char(ley_fecha, 'YYYY-MM-DD') AS ley_fecha, url
                      FROM proyectos_ley WHERE id > $3 AND ${filtro} ORDER BY id LIMIT ${LOTE}`,
    fila: (r) => [r.nuevo ? "Nuevo" : "Modificado", r.periodo, CAMARA[r.camara] || r.camara, r.numero, r.presentado,
      r.titulo, r.sumilla, r.autor, r.proponente, r.estado, r.rubro,
      r.ley_numero ? `${r.ley_tipo || "Ley"} ${r.ley_numero}` : "", r.ley_fecha, enlace(r.url, "Ver proyecto")],
  },
  seguimientos: {
    nombre: "Seguimiento de proyectos",
    columnas: [
      ["Cambio", 12], ["Proyecto", 18], ["Periodo", 10], ["Fecha", 12], ["Cámara", 12], ["Estado", 34],
      ["Comisiones", 50], ["Detalle", 80],
    ],
    sql: (filtro) => `SELECT s.id, TRUE AS nuevo, p.numero, p.periodo, to_char(s.fecha AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
                             s.camara, s.estado, s.comisiones, s.detalle
                      FROM seguimientos s JOIN proyectos_ley p ON p.id = s.proyecto_id
                      WHERE s.id > $3 AND ${filtro.replaceAll("modificado_en", "s.creado_en")} ORDER BY s.id LIMIT ${LOTE}`,
    fila: (r) => ["Nuevo", r.numero, r.periodo, r.fecha, CAMARA[r.camara] || r.camara, r.estado, r.comisiones, r.detalle],
  },
};

const CAMARA = { C: "Congreso", D: "Diputados", S: "Senado" };

// Excel no acepta mas de 32.767 caracteres por celda ni caracteres de control (los quita al «reparar»)
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const celda = (v) => {
  if (typeof v !== "string") return v ?? "";
  const t = v.replace(CONTROL, " ");
  return t.length > 32000 ? t.slice(0, 32000) + "…" : t;
};
// Enlace como formula HIPERVINCULO: Excel admite como maximo 65.530 enlaces normales por hoja (y aqui hay
// cientos de miles); las formulas no tienen ese limite y se abren igual con un clic.
const enlace = (url, texto = "Abrir") => {
  if (!url || url.length > 250) return url || "";
  const u = url.replace(CONTROL, "").replace(/"/g, '""');
  return { formula: `HYPERLINK("${u}","${texto}")`, result: texto };
};

export async function ultimaDescarga(usuarioId) {
  const [d] = await consultar(
    `SELECT id, completa, to_char(hasta AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') AS hasta_txt, hasta
     FROM excel_descargas WHERE usuario_id = $1 ORDER BY hasta DESC LIMIT 1`,
    [usuarioId]
  );
  return d || null;
}

export async function historialDescargas(usuarioId) {
  return consultar(
    `SELECT completa, normas, proyectos, seguimientos,
            to_char(creado_en AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') AS cuando
     FROM excel_descargas WHERE usuario_id = $1 ORDER BY creado_en DESC LIMIT 10`,
    [usuarioId]
  );
}

// Cuantos documentos traeria la descarga de cambios (para mostrarlo antes de descargar)
export async function contarCambios(desde) {
  const [c] = await consultar(
    `SELECT (SELECT count(*) FROM normas WHERE modificado_en > $1)::int AS normas,
            (SELECT count(*) FROM proyectos_ley WHERE modificado_en > $1)::int AS proyectos,
            (SELECT count(*) FROM seguimientos WHERE creado_en > $1)::int AS seguimientos`,
    [desde]
  );
  return c;
}

// Arma el Excel mientras se descarga (no se guarda entero en memoria). Devuelve un flujo para la respuesta.
// completa: todo; si no, lo que cambio despues de «desde». Al terminar sin errores anota la descarga.
export function excelEnFlujo({ usuarioId, completa, desde }) {
  const salida = new PassThrough();
  const libro = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: salida, useStyles: true, useSharedStrings: false });
  libro.creator = "normas-jmsr";

  (async () => {
    const [{ hasta }] = await consultar(`SELECT now() AS hasta`);
    const base = completa ? "1970-01-01T00:00:00Z" : desde;
    // Lo que cambie mientras se arma este Excel queda para la proxima descarga
    const filtro = `modificado_en > $1::timestamptz AND modificado_en <= $2::timestamptz`;
    const cuenta = {};
    for (const [clave, h] of Object.entries(HOJAS)) {
      const hoja = libro.addWorksheet(h.nombre, { views: [{ state: "frozen", ySplit: 1 }] });
      const cols = completa ? h.columnas.slice(1) : h.columnas;
      hoja.columns = cols.map(([header, width]) => ({ header, width }));
      hoja.getRow(1).font = { bold: true };
      hoja.getRow(1).commit();
      let ultimo = 0;
      cuenta[clave] = 0;
      for (;;) {
        const filas = await consultar(h.sql(filtro), [base, hasta, ultimo]);
        for (const r of filas) {
          const valores = h.fila(r).map((v) => (v && typeof v === "object" ? v : celda(v)));
          hoja.addRow(completa ? valores.slice(1) : valores).commit();
        }
        cuenta[clave] += filas.length;
        if (filas.length < LOTE) break;
        ultimo = filas[filas.length - 1].id;
      }
      hoja.commit();
    }
    await libro.commit();
    await consultar(
      `INSERT INTO excel_descargas (usuario_id, completa, desde, hasta, normas, proyectos, seguimientos)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuarioId, completa, completa ? null : desde, hasta, cuenta.normas, cuenta.proyectos, cuenta.seguimientos]
    );
  })().catch((e) => {
    console.error(e);
    salida.destroy(e);
  });

  return Readable.toWeb(salida);
}
