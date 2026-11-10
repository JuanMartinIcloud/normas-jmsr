import { exigirUsuario } from "../../lib/auth";
import { mensajeError } from "../../lib/errores";
import { consultarGuardado, leerFiltros, construirWhere, hoyLima, POR_PAGINA, prepararBusqueda, corregirConsulta, ordenNormas } from "../../lib/db";
import FiltrarResultados from "./buscar/FiltrarResultados";
import { fragmentos } from "../../lib/textos";
import Fragmento from "../Fragmento";
import { cargarResumen, fechasConResumen, ayerLima } from "../../lib/resumenes";
import ResumenIA from "../ResumenIA";
import BotonResumir from "../BotonResumir";
import Marcar from "../Marcar";

export const dynamic = "force-dynamic";

// Construye una direccion conservando los filtros actuales y cambiando lo indicado
function enlace(f, cambios = {}) {
  const base = { ...f, ...cambios };
  const qs = new URLSearchParams();
  for (const k of ["q", "fecha", "desde", "hasta", "anio", "sector", "rubro", "tipo"]) {
    if (base[k]) qs.set(k, base[k]);
  }
  if (base.central) qs.set("central", "1");
  if (base.leyes) qs.set("leyes", "1");
  if (base.terminos && base.terminos.length) qs.set("t", base.terminos.join("|"));
  if (base.refinar && base.refinar.length) qs.set("y", base.refinar.join("|"));
  if (base.pregunta) qs.set("pregunta", base.pregunta);
  if (base.orden) qs.set("orden", base.orden);
  if (base.pagina && base.pagina > 1) qs.set("p", String(base.pagina));
  const s = qs.toString();
  return s ? `/?${s}` : "/";
}

async function cargar(f) {
  await prepararBusqueda(f, "N");
  const { where, params } = construirWhere(f);
  const pLista = [...params];
  const orden = ordenNormas(f, pLista);
  const offset = (f.pagina - 1) * POR_PAGINA;

  const [resumen, anios, sectores, rubros, tipos, filas, total] = await Promise.all([
    consultarGuardado(`SELECT count(*)::int AS total, min(fecha)::text AS primera, max(fecha)::text AS ultima FROM normas`, [], "catalogos"),
    consultarGuardado(`SELECT extract(year FROM fecha)::int AS anio, count(*)::int AS n FROM normas GROUP BY 1 ORDER BY 1 DESC`, [], "catalogos"),
    consultarGuardado(`SELECT sector AS valor, count(*)::int AS n FROM normas WHERE sector IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, [], "catalogos"),
    consultarGuardado(`SELECT rubro AS valor, count(*)::int AS n FROM normas WHERE rubro IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, [], "catalogos"),
    // Un solo valor por tipo aunque El Peruano lo escriba con o sin tilde ("Resolucion" / "Resolución")
    consultarGuardado(`SELECT max(tipo) AS valor, count(*)::int AS n FROM normas WHERE tipo IS NOT NULL
               GROUP BY translate(lower(tipo), 'áéíóúü', 'aeiouu') ORDER BY 2 DESC LIMIT 40`, [], "catalogos"),
    consultarGuardado(
      `SELECT id, fecha::text AS fecha, tipo, numero, entidad, sector, rubro, sumilla, url_pdf, url_detalle, extraordinaria,
              hash_unico
       FROM normas ${where} ORDER BY ${orden} LIMIT ${POR_PAGINA} OFFSET ${offset}`,
      pLista
    ),
    consultarGuardado(`SELECT count(*)::int AS n FROM normas ${where}`, params),
  ]);

  let frags = {};
  try {
    frags = await fragmentos("N", filas.map((n) => n.hash_unico), [f.q, ...f.terminos, ...f.refinar]);
  } catch (e) {
    frags = {};
  }
  // Si con los filtros puestos (fecha, año, sector...) no sale nada, cuenta cuántas hay en todas las fechas
  let sinFiltros = 0;
  const otrosFiltros = f.fecha || f.desde || f.hasta || f.anio || f.sector || f.rubro || f.tipo || f.central || f.leyes;
  if (f.q && total[0].n === 0 && otrosFiltros) {
    const g = { q: f.q, terminos: f.terminos, refinar: f.refinar, clavesTexto: f.clavesTexto, clavesRefinar: f.clavesRefinar, clavesTodas: f.clavesTodas };
    const w = construirWhere(g);
    try {
      const [c] = await consultarGuardado(`SELECT count(*)::int AS n FROM normas ${w.where}`, w.params);
      sinFiltros = c.n;
    } catch (e) {
      sinFiltros = 0;
    }
  }
  return { resumen: resumen[0], anios, sectores, rubros, tipos, filas, total: total[0].n, frags, sinFiltros };
}

function Opciones({ lista }) {
  return (
    <>
      <option value="">Todos</option>
      {lista.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.valor} ({o.n.toLocaleString("es-PE")})
        </option>
      ))}
    </>
  );
}

export default async function Pagina({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const sp = { ...(searchParams || {}) };
  if (sp.fecha === "hoy") sp.fecha = hoyLima();
  const f = leerFiltros(sp);

  let datos;
  let corregidaDe = "";
  try {
    datos = await cargar(f);
    // Sin resultados: puede ser una palabra mal escrita ("piscologica"); se corrige y se repite
    if (datos.total < 5 && f.q) {
      const nueva = await corregirConsulta(f.q);
      if (nueva) {
        const g = { ...f, q: nueva, clavesTexto: undefined, clavesRefinar: undefined, clavesTodas: undefined, avisoTexto: undefined };
        const otra = await cargar(g);
        if (otra.total > datos.total) {
          corregidaDe = f.q;
          Object.assign(f, g);
          datos = otra;
        }
      }
    }
  } catch (e) {
    return (
      <main className="contenedor">
        <h1>Normas Legales del Perú</h1>
        <div className="error">
          <strong>No se pudo leer la base de datos.</strong>
          <p>{mensajeError(e)}</p>
        </div>
      </main>
    );
  }

  const { resumen, anios, sectores, rubros, tipos, filas, total, frags, sinFiltros } = datos;
  const paginas = Math.min(100, Math.max(1, Math.ceil(total / POR_PAGINA))); // se navega hasta la pagina 100 (para mas, afinar la busqueda)
  const hoy = hoyLima();
  const csv = enlace(f, { pagina: 1 }).replace("/?", "/api/csv?").replace(/^\/$/, "/api/csv");
  const hayFiltros =
    f.q || f.fecha || f.desde || f.hasta || f.anio || f.sector || f.rubro || f.tipo || f.central || f.leyes ||
    f.terminos.length > 0 || f.refinar.length > 0;

  // Resumen con IA: solo en la portada (sin filtros, primera pagina).
  // Si falla, la pagina sigue funcionando sin el resumen.
  let resumenIA = null;
  if (!hayFiltros && f.pagina === 1) {
    try {
      const [ultima] = await fechasConResumen(1);
      resumenIA = ultima ? await cargarResumen(ultima.fecha) : null;
    } catch (e) {
      resumenIA = null;
    }
  }
  const ayer = ayerLima();

  return (
    <main className="contenedor">
      <h1>Normas Legales del Perú</h1>
      <p className="sub">
        {resumen.total.toLocaleString("es-PE")} normas guardadas
        {resumen.primera ? ` · desde ${resumen.primera} hasta ${resumen.ultima}` : ""}
      </p>

      <nav className="atajos" aria-label="Atajos">
        <a className={`atajo ${f.fecha === hoy ? "activo" : ""}`} href={enlace({}, { fecha: hoy })}>Hoy</a>
        <a className={`atajo ${!hayFiltros ? "activo" : ""}`} href="/">Más recientes</a>
        <a className={`atajo ${f.leyes ? "activo" : ""}`} href={enlace(f, { leyes: !f.leyes, pagina: 1 })}>
          Leyes y normas con rango de ley
        </a>
        <a className={`atajo ${f.central ? "activo" : ""}`} href={enlace(f, { central: !f.central, pagina: 1 })}>
          Solo gobierno central
        </a>
        <a className="atajo" href="/resumenes">Resúmenes diarios</a>
        <a className="atajo" href="/buscar">Buscar en todo</a>
        <a className="atajo" href="/proyectos">Proyectos de ley →</a>
        <a className="atajo" href="/areas">Monitoreo por áreas →</a>
        <a className="atajo" href="/excel">Descargar en Excel</a>
      </nav>

      {!hayFiltros && f.pagina === 1 && (
        <>
          {(!resumenIA || resumenIA.fecha < ayer) && (
            <p className="ia-pendiente">
              El resumen con IA de lo publicado ayer se prepara cada madrugada y estará listo antes de las 8:00 a. m.
              {resumenIA ? " Mientras tanto, este es el último disponible." : ""}
            </p>
          )}
          {resumenIA && <ResumenIA resumen={resumenIA} />}
        </>
      )}

      {anios.length > 0 && (
        <div className="panel">
          <h2>Por año</h2>
          <div className="anios">
            {anios.map((a) => (
              <a
                key={a.anio}
                className={`atajo ${f.anio === String(a.anio) ? "activo" : ""}`}
                href={enlace({ central: f.central }, { anio: String(a.anio) })}
              >
                {a.anio} · {a.n.toLocaleString("es-PE")}
              </a>
            ))}
          </div>
        </div>
      )}

      <form className="filtros" method="get" action="/">
        <label className="ancho">
          Buscar por palabra, número o entidad
          <input type="search" name="q" defaultValue={f.q} placeholder="Ej.: transferencia de partidas, 505-2026, MINSA" />
        </label>
        <label>
          Rubro
          <select name="rubro" defaultValue={f.rubro}><Opciones lista={rubros} /></select>
        </label>
        <label>
          Sector
          <select name="sector" defaultValue={f.sector}><Opciones lista={sectores} /></select>
        </label>
        <label>
          Tipo de norma
          <select name="tipo" defaultValue={f.tipo}><Opciones lista={tipos} /></select>
        </label>
        <label>
          Fecha exacta
          <input type="date" name="fecha" defaultValue={f.fecha} />
        </label>
        <label>
          Desde
          <input type="date" name="desde" defaultValue={f.desde} />
        </label>
        <label>
          Hasta
          <input type="date" name="hasta" defaultValue={f.hasta} />
        </label>
        <label className="check ancho">
          <input type="checkbox" name="central" value="1" defaultChecked={f.central} />
          Solo gobierno central (excluye municipalidades y gobiernos regionales)
        </label>
        <label className="check ancho">
          <input type="checkbox" name="leyes" value="1" defaultChecked={f.leyes} />
          Solo leyes y normas con rango de ley (leyes, decretos legislativos, decretos de urgencia, resoluciones legislativas)
        </label>
        <div className="acciones">
          <button className="boton" type="submit">Buscar</button>
          <a className="boton sec" href="/">Limpiar</a>
          <a className="boton sec" href={csv}>Descargar en Excel (CSV, hasta 5.000)</a>
        </div>
      </form>

      {f.avisoTexto && (
        <p className="ia-aviso">Una parte de la búsqueda dentro de los documentos tardó demasiado y se omitió; los resultados pueden estar incompletos.</p>
      )}
      {corregidaDe && (
        <p className="ia-aviso">
          Se buscó <strong>«{f.q}»</strong> en lugar de «{corregidaDe}» (posible error de escritura).
        </p>
      )}
      {f.pregunta && (
        <p className="pregunta">
          Búsqueda con IA de: <strong>«{f.pregunta}»</strong>{f.terminos.length > 0 && <> · términos: {f.terminos.join(", ")}</>}
        </p>
      )}
      {f.refinar.length > 0 && (
        <p className="terminos">
          <span>Filtrado por:</span>
          {f.refinar.map((r) => (
            <a key={r} className="etq" href={enlace(f, { refinar: f.refinar.filter((x) => x !== r), pagina: 1 })} title="Quitar este filtro">
              {r} ✕
            </a>
          ))}
          <a href={enlace(f, { refinar: [], pagina: 1 })}>Quitar filtros</a>
        </p>
      )}
      {hayFiltros && (
        <FiltrarResultados
          ruta="/"
          params={Object.fromEntries(new URLSearchParams(enlace(f, { refinar: [], pagina: 1 }).split("?")[1] || ""))}
          refinar={f.refinar}
        />
      )}
      <p className="resumen">
        {total.toLocaleString("es-PE")} {total === 1 ? "resultado" : "resultados"} · página {f.pagina} de {paginas.toLocaleString("es-PE")}
        {f.q && f.orden !== "r" && (
          <>
            {" · "}
            {f.orden === "f" ? (
              <>Más recientes primero · <a href={enlace(f, { orden: "", pagina: 1 })}>frase exacta primero</a></>
            ) : (
              <>Frase exacta primero · <a href={enlace(f, { orden: "f", pagina: 1 })}>más recientes primero</a></>
            )}
          </>
        )}
      </p>

      {hayFiltros && (
        <BotonResumir
          ambito="normas"
          cantidad={total}
          filtros={{
            q: f.q, fecha: f.fecha, desde: f.desde, hasta: f.hasta, anio: f.anio, sector: f.sector,
            rubro: f.rubro, tipo: f.tipo, central: f.central ? "1" : "", leyes: f.leyes ? "1" : "",
            t: f.terminos.join("|"), y: f.refinar.join("|"), orden: f.orden,
          }}
        />
      )}

      {filas.length === 0 ? (
        <p className="vacio">
          No hay normas para esta búsqueda con los filtros elegidos.
          {sinFiltros > 0 ? (
            <>
              {" "}En todas las fechas hay {sinFiltros.toLocaleString("es-PE")}:{" "}
              <a href={enlace({ q: f.q, terminos: f.terminos, refinar: f.refinar, pregunta: f.pregunta, orden: f.orden })}>ver las {sinFiltros.toLocaleString("es-PE")} →</a>
            </>
          ) : (
            f.fecha === hoy && " Las normas del día se cargan automáticamente por la noche y se revisan de nuevo de madrugada."
          )}
        </p>
      ) : (
        <div className="lista">
          {filas.map((n) => (
            <article className="norma" key={n.id}>
              <div className="linea1">
                <span className="titulo">{[n.tipo, n.numero].filter(Boolean).join(" N° ")}</span>
                <span className="entidad">{n.entidad}</span>
                <span className="fecha">{n.fecha}</span>
              </div>
              <p className="sumilla">{n.sumilla}</p>
              <Fragmento texto={frags[n.hash_unico]} />
              <div className="etiquetas">
                <Marcar
                  tipo="N"
                  id={String(n.id)}
                  etiqueta={`${[n.tipo, n.numero].filter(Boolean).join(" N° ")} (${n.fecha})`}
                />
                {n.rubro && <span className="etq">{n.rubro}</span>}
                {n.sector && <span className="etq gris">{n.sector}</span>}
                {n.extraordinaria && <span className="etq gris">Edición extraordinaria</span>}
                <span className="enlaces">
                  {n.url_detalle && <a href={n.url_detalle} target="_blank" rel="noopener noreferrer">Ver</a>}
                  {n.url_pdf && (
                    <>
                      {" · "}
                      <a href={n.url_pdf} target="_blank" rel="noopener noreferrer">PDF</a>
                    </>
                  )}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {paginas > 1 && (
        <div className="paginas">
          {f.pagina > 1 && <a className="boton sec" href={enlace(f, { pagina: f.pagina - 1 })}>← Anterior</a>}
          <span>{f.pagina} / {paginas.toLocaleString("es-PE")}</span>
          {f.pagina < paginas && <a className="boton sec" href={enlace(f, { pagina: f.pagina + 1 })}>Siguiente →</a>}
        </div>
      )}
    </main>
  );
}
