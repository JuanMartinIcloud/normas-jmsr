import { consultar } from "./db";
import { renovar } from "./bases";

// Analisis a pedido: un mes del monitoreo, documentos de una busqueda guardada aun sin revisar, o documentos
// pasados a mano a "impacto empresarial". Se anotan en la tabla analisis_pedidos y los atiende la tarea
// "Monitoreo empresarial" (modo pedidos). Si en Vercel esta la variable GITHUB_TAREAS (clave de GitHub con
// permiso solo para lanzar tareas de este repositorio), la tarea se lanza al momento; si no, la atiende la
// ejecucion de la madrugada.

const REPO = "JuanMartinIcloud/normas-jmsr";
let tablaLista = false;

async function asegurarTabla() {
  if (tablaLista) return;
  await consultar(`CREATE TABLE IF NOT EXISTS analisis_pedidos (
    id BIGSERIAL PRIMARY KEY, tipo CHAR(1) NOT NULL, ref TEXT NOT NULL, forzar BOOLEAN NOT NULL DEFAULT FALSE,
    pedido_por TEXT, estado TEXT NOT NULL DEFAULT 'pendiente', creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    hecho_en TIMESTAMPTZ)`);
  await consultar(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_pendientes ON analisis_pedidos (tipo, ref) WHERE estado = 'pendiente'`);
  await consultar(`ALTER TABLE analisis ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT FALSE`);
  tablaLista = true;
}

// Anota pedidos: lista de { tipo: "M" | "N" | "P", ref, forzar }
export async function anotarPedidos(lista, quien = null) {
  const validos = (lista || []).filter(
    (x) => (x.tipo === "M" && /^\d{4}-\d{2}$/.test(String(x.ref))) || (/^[NP]$/.test(x.tipo) && /^\d{1,18}$/.test(String(x.ref)))
  );
  if (!validos.length) return 0;
  await asegurarTabla();
  await consultar(
    `INSERT INTO analisis_pedidos (tipo, ref, forzar, pedido_por)
     SELECT * FROM unnest($1::char[], $2::text[], $3::boolean[], $4::text[])
     ON CONFLICT (tipo, ref) WHERE estado = 'pendiente'
     DO UPDATE SET forzar = analisis_pedidos.forzar OR EXCLUDED.forzar`,
    [validos.map((x) => x.tipo), validos.map((x) => String(x.ref)), validos.map((x) => Boolean(x.forzar)), validos.map(() => quien)]
  );
  return validos.length;
}

// Pedidos aun pendientes: { meses: Set("AAAA-MM"), docs: Map("N123" -> forzar) }
export async function pedidosPendientes() {
  await asegurarTabla();
  const filas = await consultar(`SELECT tipo, ref, forzar FROM analisis_pedidos WHERE estado = 'pendiente'`);
  const meses = new Set();
  const docs = new Map();
  for (const f of filas) {
    if (f.tipo === "M") meses.add(f.ref);
    else docs.set(`${f.tipo}${f.ref}`, f.forzar);
  }
  return { meses, docs };
}

// Lanza la tarea de analisis al momento (si esta configurada la clave de GitHub). Devuelve true si se lanzo.
export async function lanzarAnalisis() {
  const clave = (process.env.GITHUB_TAREAS || "").trim();
  if (!clave) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/monitoreo.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { modo: "pedidos" } }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (r.status !== 204) console.error(`GitHub respondio ${r.status} al lanzar el analisis`);
    return r.status === 204;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// "Pasar a impacto empresarial": si ya tiene su analisis completo, entra al reporte al momento;
// si no, se pide el analisis completo (sin pasar por el filtro). Devuelve "listo" o "pedido".
export async function pasarAImpacto(tipo, id, quien) {
  await asegurarTabla();
  const [a] = await consultar(
    `SELECT id, (resumen IS NOT NULL AND resumen <> '') AS completo FROM analisis WHERE tipo = $1 AND ref_id = $2`,
    [tipo, Number(id)]
  );
  if (a && a.completo) {
    await consultar(
      `UPDATE analisis SET relevante = TRUE, manual = TRUE, excluido = FALSE, excluido_por = NULL, excluido_en = NULL WHERE id = $1`,
      [a.id]
    );
    renovar("monitoreo");
    return "listo";
  }
  await anotarPedidos([{ tipo, ref: String(id), forzar: true }], quien);
  return "pedido";
}

// "Quitar de impacto empresarial" (igual que «Quitar del reporte» en el monitoreo)
export async function quitarDeImpacto(tipo, id, quien) {
  await consultar(
    `UPDATE analisis SET excluido = TRUE, excluido_por = $3, excluido_en = now() WHERE tipo = $1 AND ref_id = $2`,
    [tipo, Number(id), quien]
  );
  renovar("monitoreo");
}

// Estado de cada documento en el filtro empresarial: { "N123": "impacto" | "sin_impacto" | "quitado" | "pendiente" | "sin_revisar" }
export async function estadoImpacto(normas, proyectos) {
  const n = (normas || []).filter((x) => /^\d{1,18}$/.test(String(x))).map(Number);
  const p = (proyectos || []).filter((x) => /^\d{1,18}$/.test(String(x))).map(Number);
  const salida = {};
  if (!n.length && !p.length) return salida;
  const [filas, pend] = await Promise.all([
    consultar(
      `SELECT tipo, ref_id::text AS ref, relevante, excluido FROM analisis
       WHERE (tipo = 'N' AND ref_id = ANY($1::bigint[])) OR (tipo = 'P' AND ref_id = ANY($2::bigint[]))`,
      [n, p]
    ),
    pedidosPendientes(),
  ]);
  for (const f of filas) {
    salida[`${f.tipo}${f.ref}`] = f.relevante ? (f.excluido ? "quitado" : "impacto") : "sin_impacto";
  }
  for (const [k, forzar] of pend.docs) {
    if (forzar || !salida[k]) salida[k] = "pendiente";
  }
  for (const id of n) if (!salida[`N${id}`]) salida[`N${id}`] = "sin_revisar";
  for (const id of p) if (!salida[`P${id}`]) salida[`P${id}`] = "sin_revisar";
  return salida;
}
