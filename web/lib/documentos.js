import { createCipheriv } from "node:crypto";
import { Aviso } from "./errores";

// Obtiene el PDF oficial de una norma (El Peruano) y el de un proyecto de ley (Congreso)

const AGENTE = "Mozilla/5.0 (compatible; normas-jmsr/0.2; consulta de documentos publicos)";
const API_CONGRESO = "https://api.congreso.gob.pe/spley-portal-service";
// Clave publica que el propio portal del Congreso usa en el navegador para pedir un expediente
const CLAVE_PORTAL = Buffer.from("ProdALg5ZrAsxBMD", "utf8");
const MAX_PDF = 45 * 1024 * 1024;

async function pedir(url, opciones = {}, segundos = 60) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), segundos * 1000);
  try {
    return await fetch(url, { ...opciones, signal: control.signal, cache: "no-store" });
  } finally {
    clearTimeout(reloj);
  }
}

// ---------------------------------------------------------------- El Peruano

const EPDOC = "https://epdoc2.elperuano.pe/EpPo/VistaDE.asp";

// Codigo de la norma (ej. "2562861-1"), tomado de su direccion en El Peruano
export function codigoNorma(norma) {
  const url = norma.url_detalle || "";
  // Enlaces nuevos: .../dispositivo/NL/2562861-1 · antiguos: .../normaslegales/<titulo>-1849787-2/
  let m = /\/dispositivo\/[A-Z]+\/(\d+-\d+)/.exec(url);
  if (m) return m[1];
  // epdoc2 ...VistaDE.asp?Referencias=<base64 de codigo + AAAAMMDD>
  m = /Referencias=([A-Za-z0-9+/=_-]+)/.exec(url);
  if (m) {
    const dec = Buffer.from(decodeURIComponent(m[1]), "base64").toString("latin1");
    const m2 = /^(\d+)[-_](\d{1,3}?)(\d{8})$/.exec(dec); // "2442245-1"+fecha o "1602563_1"+fecha
    if (m2) return `${m2[1]}-${m2[2]}`;
  }
  // .../normaslegales/<titulo>-1849787-2/ · .../2015/02/14/1200944-7.html · .../1935627-1/1935627-1.htm
  // El codigo son 6 a 8 cifras, guion y 1 a 3 cifras al final (en «...-ley-n-31838-2197008-1/» es 2197008-1)
  m = /(?<!\d)(\d{6,8}-\d{1,3})(?:\.html?)?\/?$/.exec(url);
  if (m) return m[1];
  m = /(\d{5,}-\d+)(?:-\d+)?(?:\.html?)?\/?$/.exec(url);
  return m ? m[1] : null;
}

// PDF oficial de la norma (servicio de documentos de El Peruano). Devuelve { pdf, nombre } o null
export async function pdfNorma(norma) {
  const codigo = codigoNorma(norma);
  const fecha = String(norma.fecha || "").replace(/-/g, "");
  if (!codigo || !/^\d{8}$/.test(fecha)) return null;
  const ref = Buffer.from(`${codigo}${fecha}`).toString("base64");
  const r = await pedir(`${EPDOC}?Referencias=${encodeURIComponent(ref)}`, { headers: { "User-Agent": AGENTE } }, 90);
  if (!r.ok) throw new Aviso(`El Peruano respondió HTTP ${r.status}`);
  const pdf = Buffer.from(await r.arrayBuffer());
  if (pdf.subarray(0, 4).toString("latin1") !== "%PDF") throw new Aviso("El Peruano no devolvió un PDF");
  if (pdf.length > MAX_PDF) throw new Aviso("El PDF de la norma es demasiado grande (más de 45 MB)");
  return { pdf, nombre: `${[norma.tipo, norma.numero].filter(Boolean).join(" ")}.pdf` };
}

// ---------------------------------------------------------------- Congreso

function cifrar(texto) {
  const c = createCipheriv("aes-128-ecb", CLAVE_PORTAL, null);
  const salida = Buffer.concat([c.update(String(texto), "utf8"), c.final()]).toString("base64");
  return salida.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const CABECERAS_CONGRESO = {
  "User-Agent": AGENTE,
  Origin: "https://wb2server.congreso.gob.pe",
  Referer: "https://wb2server.congreso.gob.pe/",
  Accept: "application/json, text/plain, */*",
};

// El archivo es el texto del proyecto si su nombre es "PL" + su numero (PL_2973, PL 2973, PL-2973 o
// PL0297320220906 = numero con 5 cifras + fecha), sin "y otros" (esos son dictamenes de varios proyectos)
function esDelProyecto(archivo, numero) {
  const nombre = String(archivo.nombreArchivo || "").toUpperCase().trim();
  if (!numero || nombre.includes("OTROS")) return false;
  const m = nombre.match(/^PL[\s_\-.]*(\d+)/);
  if (!m) return false;
  const cifras = m[1];
  return cifras.replace(/^0+/, "") === String(numero) || (cifras.length === 13 && Number(cifras.slice(0, 5)) === numero);
}

// Elige el archivo con el texto del proyecto: el que lleva su numero; si no hay, el que se adjunto
// al presentarlo, sin oficios de remision
function elegirArchivo(expediente, numPley) {
  const m = String(numPley || "").match(/^\s*0*(\d+)/);
  const numero = m ? Number(m[1]) : null;
  const seguimientos = [...(expediente.seguimientos || [])].sort((a, b) =>
    String(a.fecha || "").localeCompare(String(b.fecha || ""))
  );
  const todos = seguimientos.flatMap((s) => (s.archivos || []).map((a) => ({ ...a, estado: s.desEstado })));
  const utiles = todos.filter((a) => a.proyectoArchivoId && a.activo !== false && a.publico !== false);
  const sinOficio = utiles.filter((a) => !/oficio|cargo|decreto de remisi/i.test(`${a.nombreArchivo} ${a.descripcion}`));
  const propios = utiles.filter((a) => esDelProyecto(a, numero));
  return propios[0] || sinOficio[0] || utiles[0] || null;
}

// Devuelve { pdf: Buffer, nombre, sumilla } del proyecto; pdf puede ser null si el Congreso no tiene archivo
export async function documentoProyecto(p) {
  const url = `${API_CONGRESO}/expediente/${cifrar(p.periodo)}/${cifrar(p.num_pley)}?codTipoParl=${encodeURIComponent(p.camara || "C")}`;
  const r = await pedir(url, { headers: CABECERAS_CONGRESO });
  if (!r.ok) throw new Aviso(`El Congreso respondió HTTP ${r.status}`);
  const exp = ((await r.json()) || {}).data || {};
  const sumilla = (exp.general && exp.general.sumilla) || "";
  const archivo = elegirArchivo(exp, p.num_pley);
  if (!archivo) return { pdf: null, nombre: "", sumilla };
  const codigo = Buffer.from(String(archivo.proyectoArchivoId)).toString("base64");
  const rp = await pedir(`${API_CONGRESO}/archivo/${codigo}/pdf`, { headers: CABECERAS_CONGRESO }, 90);
  if (!rp.ok) throw new Aviso(`No se pudo descargar el PDF del proyecto (HTTP ${rp.status})`);
  const pdf = Buffer.from(await rp.arrayBuffer());
  if (pdf.subarray(0, 4).toString("latin1") !== "%PDF") throw new Aviso("El Congreso no devolvió un PDF válido");
  if (pdf.length > MAX_PDF) throw new Aviso("El PDF del proyecto es demasiado grande (más de 45 MB)");
  return { pdf, nombre: archivo.nombreArchivo || `${p.numero}.pdf`, sumilla };
}
