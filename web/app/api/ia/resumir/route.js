import { usuarioActual } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { consultarGuardado, leerFiltros, construirWhere, prepararBusqueda, ordenNormas } from "../../../../lib/db";
import { colsLey, estadoProyecto } from "../../../../lib/leyes";
import { fragmentos, claveProyecto } from "../../../../lib/textos";
import { leerFiltrosProyectos, whereProyectos, ordenProyectos } from "../../../../lib/proyectos";
import { urlProyecto } from "../../../../lib/resumenes";
import { generarJSON, ErrorIA } from "../../../../lib/gemini";
import { claveDe, buscarGuardada, guardarConsulta } from "../../../../lib/consultasIA";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LIMITE = 150; // cuantos resultados (los mas recientes) se envian a la IA por grupo

const corta = (t, n) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
};

const PUNTOS = {
  type: "OBJECT",
  properties: {
    panorama: { type: "STRING" },
    puntos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { texto: { type: "STRING" }, refs: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["texto", "refs"],
      },
    },
  },
  required: ["panorama", "puntos"],
};

const ESQUEMA = {
  type: "OBJECT",
  properties: { normas: PUNTOS, proyectos: PUNTOS },
  required: ["normas", "proyectos"],
};

const INSTRUCCIONES = `Eres un asistente de un estudio de abogados en Perú. Recibes el resultado de una búsqueda
en normas legales (El Peruano) y en proyectos de ley del Congreso. Resume lo encontrado.

Reglas:
- Español claro y profesional, para abogados.
- Usa solo los datos recibidos (sumillas y títulos oficiales). No inventes efectos, fechas ni cifras.
- "normas": resume las normas legales; "proyectos": resume los proyectos de ley (menciona su estado
  cuando sea relevante, por ejemplo si ya fueron aprobados o publicados).
- En cada grupo, "panorama" son 2 a 4 oraciones con lo esencial y "puntos" agrupa los documentos por
  subtema o por idea común (un punto puede citar varios documentos). Ordena de lo más a lo menos relevante.
- Cada documento tiene un código entre corchetes ([N12] norma, [P34] proyecto). En "refs" pon los
  códigos sin corchetes. Usa solo códigos que existan.
- Si un grupo no tiene documentos, deja "panorama" vacío y "puntos" como lista vacía.
- Responde solo con el JSON pedido.`;

function limpiarGrupo(g, validas) {
  const puntos = [];
  for (const p of (g && g.puntos) || []) {
    const texto = String((p && p.texto) || "").trim();
    if (!texto) continue;
    const refs = [];
    for (const r of p.refs || []) {
      const c = String(r).replace(/[\[\]\s]/g, "").toUpperCase();
      if (validas.has(c) && !refs.includes(c)) refs.push(c);
    }
    puntos.push({ texto, refs });
  }
  return { panorama: String((g && g.panorama) || "").trim(), puntos };
}

export async function POST(request) {
  if (!(await usuarioActual())) return Response.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 });
  const inicio = Date.now();
  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido" }, { status: 400 });
  }
  const ambito = ["normas", "proyectos", "ambos"].includes(cuerpo.ambito) ? cuerpo.ambito : "ambos";
  const crudos = cuerpo.filtros && typeof cuerpo.filtros === "object" ? cuerpo.filtros : {};
  const texto = {};
  for (const [k, v] of Object.entries(crudos)) if (typeof v === "string" || typeof v === "boolean") texto[k] = String(v === true ? "1" : v);

  const fn = leerFiltros(texto);
  const fp = leerFiltrosProyectos(texto);

  // Filtros tal como los pidio el usuario (sin la lista de ids hallados en textos)
  const filtrosN = { ...fn };
  const filtrosP = { ...fp };

  try {
    await Promise.all([
      ambito !== "proyectos" ? prepararBusqueda(fn, "N") : null,
      ambito !== "normas" ? prepararBusqueda(fp, "P") : null,
    ]);
    const pedidos = [];
    if (ambito !== "proyectos") {
      const { where, params } = construirWhere(fn);
      const ordN = [...params];
      pedidos.push(
        consultarGuardado(
          `SELECT id::text AS id, fecha::text AS fecha, tipo, numero, entidad, sumilla, url_detalle, url_pdf, hash_unico
           FROM normas ${where} ORDER BY ${ordenNormas(fn, ordN)} LIMIT ${LIMITE}`,
          ordN
        ),
        consultarGuardado(`SELECT count(*)::int AS n FROM normas ${where}`, params)
      );
    } else pedidos.push([], [{ n: 0 }]);
    if (ambito !== "normas") {
      const { where, params } = whereProyectos(fp);
      const ordP = [...params];
      pedidos.push(
        consultarGuardado(
          `SELECT id::text AS id, numero, periodo, camara, num_pley, url, fecha_presentacion::text AS fecha,
                  titulo, sumilla, proponente, estado, ${colsLey("proyectos_ley")}
           FROM proyectos_ley ${where} ORDER BY ${ordenProyectos(fp, ordP)} LIMIT ${LIMITE}`,
          ordP
        ),
        consultarGuardado(`SELECT count(*)::int AS n FROM proyectos_ley ${where}`, params)
      );
    } else pedidos.push([], [{ n: 0 }]);
    const [normas, [tn], proyectos, [tp]] = await Promise.all(pedidos);

    if (!normas.length && !proyectos.length) {
      return Response.json({ error: "No hay resultados para resumir con estos filtros." }, { status: 404 });
    }

    const referencias = {};
    for (const n of normas) {
      referencias[`N${n.id}`] = {
        texto: [n.tipo, n.numero].filter(Boolean).join(" N° ") || "Norma",
        url: n.url_detalle || n.url_pdf || null,
      };
    }
    for (const p of proyectos) referencias[`P${p.id}`] = { texto: `PL ${p.numero}`, url: urlProyecto(p) };

    const totales = {
      normas: { total: tn.n, incluidas: normas.length },
      proyectos: { total: tp.n, incluidas: proyectos.length },
    };
    const clave = claveDe("resumir", { ambito, fn: filtrosN, fp: filtrosP, ids: Object.keys(referencias) });
    const guardada = await buscarGuardada(clave);
    if (guardada) {
      return Response.json({ ...guardada.resultado, referencias, totales, modelo: guardada.modelo, guardado: true });
    }

    // Pasajes del texto completo donde aparece lo buscado (si hay busqueda por palabras)
    const terminos = [fn.q || fp.q, ...(fn.terminos || [])].filter(Boolean);
    const [fragN, fragP] = await Promise.all([
      fragmentos("N", normas.map((n) => n.hash_unico), terminos).catch(() => ({})),
      fragmentos("P", proyectos.map(claveProyecto), terminos).catch(() => ({})),
    ]);
    const limpiarFrag = (t) => corta(String(t || "").replace(/\[\[|\]\]/g, ""), 450);

    const busqueda = [
      fn.q || fp.q ? `Búsqueda: "${fn.q || fp.q}"` : "Búsqueda: sin palabra clave (documentos más recientes)",
      fn.terminos.length ? `Términos relacionados incluidos: ${fn.terminos.join("; ")}` : "",
      "Nota: algunos documentos coinciden por su texto completo y no por su sumilla; para ellos se incluye el pasaje donde aparece lo buscado.",
      fn.desde || fn.hasta ? `Fechas: ${fn.desde || "inicio"} a ${fn.hasta || "hoy"}` : "",
    ].filter(Boolean);
    const lineas = [...busqueda, "", `NORMAS LEGALES (${normas.length} de ${tn.n}):`];
    for (const n of normas) {
      lineas.push(
        `[N${n.id}] ${n.fecha} | ${[n.tipo, n.numero].filter(Boolean).join(" N° ")} | ${n.entidad || ""} | ${corta(n.sumilla, 500)}` +
          (fragN[n.hash_unico] ? ` | pasaje del texto: ${limpiarFrag(fragN[n.hash_unico])}` : "")
      );
    }
    if (!normas.length) lineas.push("(ninguna)");
    lineas.push("", `PROYECTOS DE LEY (${proyectos.length} de ${tp.n}):`);
    for (const p of proyectos) {
      lineas.push(
        `[P${p.id}] ${p.numero} | ${p.fecha || ""} | ${p.proponente || ""} | estado: ${estadoProyecto(p) || "-"} | ${corta(p.titulo, 400)}` +
          (p.sumilla ? ` | sumilla: ${corta(p.sumilla, 400)}` : "") +
          (fragP[claveProyecto(p)] ? ` | pasaje del texto: ${limpiarFrag(fragP[claveProyecto(p)])}` : "")
      );
    }
    if (!proyectos.length) lineas.push("(ninguno)");

    const { datos, modelo } = await generarJSON({
      origen: "resumir",
      instrucciones: INSTRUCCIONES,
      partes: [{ text: lineas.join("\n") }],
      esquema: ESQUEMA,
      limiteMs: Math.max(30000, 285000 - (Date.now() - inicio)),
      intentoMs: 60000, // si un modelo se demora mas de 1 minuto, se pasa al siguiente
    });
    const validas = new Set(Object.keys(referencias));
    const resultado = {
      normas: limpiarGrupo(datos.normas, validas),
      proyectos: limpiarGrupo(datos.proyectos, validas),
    };
    await guardarConsulta(clave, "resumir", { ambito, fn: filtrosN, fp: filtrosP }, resultado, modelo);
    return Response.json({ ...resultado, referencias, totales, modelo, guardado: false });
  } catch (e) {
    const estado = e instanceof ErrorIA ? e.estado : 500;
    return Response.json({ error: mensajeError(e) }, { status: estado });
  }
}
