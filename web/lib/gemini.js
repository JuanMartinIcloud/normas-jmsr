// Cliente de la API de Google Gemini para la web (capa gratuita).
// Usa las variables de entorno de Vercel: GEMINI_API_KEY (obligatoria) y GEMINI_MODELOS (opcional: modelos
// adicionales que se prueban al final).
// Dos grupos de modelos: las consultas del usuario usan primero los Flash (mas precisos) y, si se agotaron,
// los Lite; el trabajo automatico (resumen de busquedas guardadas) usa solo Lite, para no gastar los Flash.
// Cada consulta queda anotada en la tabla "uso_ia" (modelo y resultado) para medir el cupo real.
import { Aviso } from "./errores";
import { after } from "next/server";
import { ejecutar, URL_PRINCIPAL } from "./bases";

const API = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const SUBIDA = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const FLASH = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.7-flash", "gemini-3.5-flash"];
const LITE = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite-preview"];
// Reserva: se prueba al final si los anteriores agotaron su cupo del dia (no es Flash)
const RESERVA = ["gemma-4-31b-it"];

export class ErrorIA extends Aviso {
  constructor(mensaje, estado = 502) {
    super(mensaje);
    this.estado = estado;
  }
}

function clave() {
  const k = (process.env.GEMINI_API_KEY || "").trim();
  if (!k) {
    throw new ErrorIA(
      "Falta la clave de Gemini en Vercel. Agrégala en Settings > Environment Variables con el nombre GEMINI_API_KEY y vuelve a publicar.",
      503
    );
  }
  return k;
}

function modelos(perfil = "usuario") {
  const extra = (process.env.GEMINI_MODELOS || "").split(",").map((m) => m.trim()).filter((m) => m && !m.startsWith("gemini-2.5"));
  const lista = perfil === "automatico" ? [...LITE, ...RESERVA] : [...FLASH, ...LITE, ...RESERVA, ...extra];
  return [...new Set(lista)];
}

// Registro de cada consulta (no detiene nada si falla)
let tablaUso = false;
function registrar(modelo, resultado, http, origen) {
  // after(): se escribe despues de responder al usuario, sin demorarlo (y sin que Vercel lo corte)
  after(async () => {
    try {
      if (!URL_PRINCIPAL) return;
      if (!tablaUso) {
        await ejecutar(URL_PRINCIPAL, `CREATE TABLE IF NOT EXISTS uso_ia (id BIGSERIAL PRIMARY KEY, creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
          origen TEXT, modelo TEXT NOT NULL, resultado TEXT NOT NULL, http INTEGER)`);
        tablaUso = true;
      }
      await ejecutar(URL_PRINCIPAL, `INSERT INTO uso_ia (origen, modelo, resultado, http) VALUES ($1, $2, $3, $4)`, [
        String(origen).slice(0, 60), modelo, resultado, http,
      ]);
    } catch (e) {
      console.error(e);
    }
  });
}

// Los modelos Gemma no aceptan instrucciones de sistema ni modo JSON: van dentro del mensaje
function paraGemma(cuerpo) {
  const instr = cuerpo.systemInstruction.parts[0].text;
  const partes = cuerpo.contents[0].parts.map((p) => ({ ...p }));
  const i = partes.findIndex((p) => typeof p.text === "string");
  const extra = `${instr}\n\nResponde ÚNICAMENTE con un objeto JSON válido, sin texto adicional.\n\n`;
  if (i >= 0) partes[i].text = extra + partes[i].text;
  else partes.unshift({ text: extra });
  return {
    contents: [{ role: "user", parts: partes }],
    generationConfig: { temperature: 0.2, maxOutputTokens: cuerpo.generationConfig.maxOutputTokens },
  };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function aJSON(texto) {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(limpio);
  } catch (e) {
    const a = limpio.indexOf("{"), b = limpio.lastIndexOf("}");   // por si el modelo agregó texto alrededor
    if (a < 0 || b <= a) throw e;
    return JSON.parse(limpio.slice(a, b + 1));
  }
}

// Sube un PDF grande a Gemini (archivos de mas de ~15 MB no caben dentro del pedido)
async function subirArchivo(buffer, nombre, tipo = "application/pdf") {
  const k = clave();
  const inicio = await fetch(SUBIDA, {
    method: "POST",
    headers: {
      "x-goog-api-key": k,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": tipo,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: nombre.slice(0, 100) } }),
    cache: "no-store",
  });
  const url = inicio.headers.get("x-goog-upload-url");
  if (!inicio.ok || !url) throw new ErrorIA(`No se pudo subir ${nombre} a Gemini (HTTP ${inicio.status})`);
  const fin = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buffer,
    cache: "no-store",
  });
  if (!fin.ok) throw new ErrorIA(`No se pudo subir ${nombre} a Gemini (HTTP ${fin.status})`);
  let archivo = (await fin.json()).file;
  // Gemini procesa el archivo unos segundos antes de poder usarlo
  for (let i = 0; i < 20 && archivo && archivo.state === "PROCESSING"; i++) {
    await esperar(2000);
    const r = await fetch(`${API}/${archivo.name}`, { headers: { "x-goog-api-key": k }, cache: "no-store" });
    archivo = await r.json();
  }
  if (!archivo || archivo.state === "FAILED") throw new ErrorIA(`Gemini no pudo procesar ${nombre}`);
  return { file_data: { mime_type: tipo, file_uri: archivo.uri } };
}

// Convierte un PDF en una "parte" del pedido: pequeño = dentro del pedido; grande = subido aparte.
// El pedido completo no puede pasar de 20 MB, por eso solo van dentro los de hasta 2 MB
// (como maximo se unen 6 documentos: 6 x 2 MB, mas lo que agrega la codificacion, cabe holgado).
export async function partePDF(buffer, nombre) {
  if (buffer.length <= 2 * 1024 * 1024) {
    return { inline_data: { mime_type: "application/pdf", data: buffer.toString("base64") } };
  }
  return subirArchivo(buffer, nombre);
}

// Modelos que respondieron "cupo agotado" (429): se saltan por 10 minutos para no perder tiempo en ellos
const agotados = new Map();
// Modelos saturados (5xx) o que no respondieron a tiempo: se saltan 2 minutos, para que la siguiente consulta
// vaya directo a un modelo que si esta respondiendo
const ocupados = new Map();
const SALTO_SATURADO = 2 * 60 * 1000;

/**
 * Pide a Gemini una respuesta JSON.
 * partes: lista de partes ({text}, {inline_data}, {file_data}).
 * limiteMs: tiempo total disponible (debe ser menor al tiempo maximo de la ruta que llama).
 * intentoMs: tiempo maximo de espera de cada modelo; si uno se demora o esta saturado, se pasa al siguiente.
 * Devuelve { datos, modelo }.
 */
export async function generarJSON({ instrucciones, partes, esquema, maxTokens = 16384, limiteMs = 50000, intentoMs, perfil = "usuario", origen = "web" }) {
  const k = clave();
  const fin = Date.now() + limiteMs;
  const tope = intentoMs || Math.max(15000, Math.floor(limiteMs / 3));
  const cuerpo = {
    systemInstruction: { parts: [{ text: instrucciones }] },
    contents: [{ role: "user", parts: partes }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
      responseSchema: esquema,
    },
  };
  const errores = [];
  let hubo400 = false;
  let lista = modelos(perfil).filter((m) => !(agotados.get(m) > Date.now()));
  if (!lista.length) lista = modelos(perfil);
  // Los saturados van al final (no se descartan: si los demas fallan, igual se prueban)
  lista = [...lista.filter((m) => !(ocupados.get(m) > Date.now())), ...lista.filter((m) => ocupados.get(m) > Date.now())];
  const vueltas = [...lista.map((m) => [m, true]), ...lista.map((m) => [m, false])];
  const reintentados = new Set();
  for (let i = 0; i < vueltas.length; i++) {
    const actual = vueltas[i];
    const [modelo, conEsquema] = actual;
    if (!conEsquema) {
      if (!hubo400) break;
      delete cuerpo.generationConfig.responseSchema;
    }
    const quedan = fin - Date.now();
    if (quedan < 4000) break;
    let r;
    try {
      r = await fetch(`${API}/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": k, "Content-Type": "application/json" },
        body: JSON.stringify(modelo.startsWith("gemma") ? paraGemma(cuerpo) : cuerpo),
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(tope, quedan - 2000)),
      });
    } catch (e) {
      errores.push(`${modelo}: ${e.name === "TimeoutError" ? "no respondió a tiempo" : e.message}`);
      registrar(modelo, "error", null, origen);
      ocupados.set(modelo, Date.now() + SALTO_SATURADO);
      continue; // demora o falla de conexion: siguiente modelo
    }
    if (r.status === 429) {
      // Limite por dia: ese modelo no responde hasta manana. Limite por minuto: se espera lo que Google
      // indica y se reintenta el mismo modelo una vez, si queda tiempo; si no, se pasa al siguiente.
      const texto = await r.text().catch(() => "");
      if (/PerDay|per day|daily/i.test(texto)) {
        registrar(modelo, "cupo_dia", 429, origen);
        agotados.set(modelo, Date.now() + 60 * 60 * 1000);
        errores.push(`${modelo}: HTTP 429 límite del día`);
        continue;
      }
      registrar(modelo, "cupo_minuto", 429, origen);
      const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(texto);
      const espera = Math.min(30, Math.max(3, m ? Math.ceil(Number(m[1])) + 1 : 10)) * 1000;
      if (fin - Date.now() > espera + 8000 && !reintentados.has(modelo)) {
        reintentados.add(modelo);
        await esperar(espera);
        vueltas.splice(vueltas.indexOf(actual) + 1, 0, actual);
      }
      errores.push(`${modelo}: HTTP 429 límite por minuto`);
      continue;
    }
    registrar(modelo, r.ok ? "ok" : "error", r.status, origen);
    if (r.ok) {
      try {
        const json = await r.json();
        const cand = (json.candidates || [])[0];
        const texto = ((cand && cand.content && cand.content.parts) || [])
          .filter((p) => !p.thought)
          .map((p) => p.text || "")
          .join("");
        if (!texto.trim()) throw new Error(`respuesta vacía (${cand ? cand.finishReason : "sin candidatos"})`);
        return { datos: aJSON(texto), modelo };
      } catch (e) {
        errores.push(`${modelo}: ${e.message}`);
        continue;
      }
    }
    const detalle = (await r.text().catch(() => "")).slice(0, 300);
    errores.push(`${modelo}: HTTP ${r.status} ${detalle}`);
    if ((r.status === 400 || r.status === 401 || r.status === 403) && /API key|API_KEY|credential/i.test(detalle)) {
      throw new ErrorIA("La clave GEMINI_API_KEY de Vercel no es válida.", 503);
    }
    if (r.status === 400) hubo400 = true;
    if (r.status >= 500) ocupados.set(modelo, Date.now() + SALTO_SATURADO);
    // 404 (modelo no existe), 400, 5xx (saturado): probar el siguiente modelo
  }
  const cupo = errores.some((e) => /HTTP 429/.test(e));
  throw new ErrorIA(
    cupo
      ? "La inteligencia artificial está muy solicitada en este momento. Intenta de nuevo en unos minutos."
      : `Gemini no respondió: ${errores.slice(-3).join(" | ")}`,
    cupo ? 429 : 502
  );
}
