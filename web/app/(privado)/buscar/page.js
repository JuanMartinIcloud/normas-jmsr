import { exigirUsuario } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { consultarGuardado, leerFiltros, construirWhere, prepararBusqueda, corregirConsulta, ordenNormas } from "../../../lib/db";
import { fragmentos, claveProyecto } from "../../../lib/textos";
import Fragmento from "../../Fragmento";
import { leerFiltrosProyectos, whereProyectos, ordenProyectos } from "../../../lib/proyectos";
import { urlProyecto } from "../../../lib/resumenes";
import BotonResumir from "../../BotonResumir";
import Marcar from "../../Marcar";
import { colsLey, estadoProyecto } from "../../../lib/leyes";
import BotonAmpliar from "./BotonAmpliar";
import FormBuscar from "./FormBuscar";
import FiltrarResultados from "./FiltrarResultados";
import GuardarBusqueda from "./GuardarBusqueda";

export const metadata = { title: "Buscar en todo · Normas Legales del Perú" };

const MOSTRAR = 20;

function qs(f, extra = {}) {
  const p = new URLSearchParams();
  for (const k of ["q", "pregunta", "desde", "hasta", "t", "y", "orden"]) if (f[k]) p.set(k, f[k]);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function buscarTodo(fn, fp, tiempos = []) {
  const t0 = Date.now();
  const marca = (x) => tiempos.push(`${x}: ${Date.now() - t0} ms`);
  await Promise.all([
    prepararBusqueda(fn, "N").then(() => marca("claves normas")),
    prepararBusqueda(fp, "P").then(() => marca("claves proyectos")),
  ]);
  const wn = construirWhere(fn);
  const wp = whereProyectos(fp);
  // El orden puede agregar parametros propios: se usan copias para no alterar los del conteo
  const pn = [...wn.params];
  const ordN = ordenNormas(fn, pn);
  const pp = [...wp.params];
  const ordP = ordenProyectos(fp, pp);
  // Una sola consulta por grupo trae el total y los primeros resultados: la lista de coincidencias
  // del texto completo (puede tener miles de claves) viaja una sola vez a la base.
  const [a, c] = await Promise.all([
    consultarGuardado(
      `SELECT id::text AS id, fecha::text AS fecha, tipo, numero, entidad, sumilla, url_detalle, url_pdf, hash_unico,
              count(*) OVER ()::int AS total
       FROM normas ${wn.where} ORDER BY ${ordN} LIMIT ${MOSTRAR}`,
      pn
    ).then((x) => (marca("lista normas"), x)),
    consultarGuardado(
      `SELECT id::text AS id, numero, periodo, camara, num_pley, url, fecha_presentacion::text AS fecha,
              titulo, sumilla, proponente, estado, ${colsLey("proyectos_ley")}, count(*) OVER ()::int AS total
       FROM proyectos_ley ${wp.where} ORDER BY ${ordP} LIMIT ${MOSTRAR}`,
      pp
    ).then((x) => (marca("lista proyectos"), x)),
  ]);
  const b = [{ n: a.length ? a[0].total : 0 }];
  const d = [{ n: c.length ? c[0].total : 0 }];
  marca(`listas (claves N ${(fn.clavesTexto || []).length}, P ${(fp.clavesTexto || []).length})`);
  const terminos = [fn.q, ...fn.terminos, ...fn.refinar];
  const [fragN, fragP] = await Promise.all([
    fragmentos("N", a.map((n) => n.hash_unico), terminos).catch(() => ({})),
    fragmentos("P", c.map(claveProyecto), terminos).catch(() => ({})),
  ]);
  marca("parrafos y conteos");
  return { normas: a, totalN: b[0].n, proyectos: c, totalP: d[0].n, fragN, fragP };
}

export default async function Buscar({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const sp = searchParams || {};
  const base = {
    q: sp.q, desde: sp.desde, hasta: sp.hasta, t: sp.t, y: sp.y, pregunta: sp.pregunta, orden: sp.orden,
  };
  const fn = leerFiltros(base);
  const fp = leerFiltrosProyectos(base);
  const filtros = {
    q: fn.q, pregunta: fn.pregunta, desde: fn.desde, hasta: fn.hasta,
    t: fn.terminos.join("|"), y: fn.refinar.join("|"), orden: fn.orden,
  };
  const hayBusqueda = Boolean(fn.q || fn.desde || fn.hasta || fn.terminos.length || fn.refinar.length);

  let normas = [];
  let proyectos = [];
  let totalN = 0;
  let totalP = 0;
  let error = "";
  let fragN = {};
  let fragP = {};
  let corregidaDe = "";
  const tiempos = [];
  if (hayBusqueda) {
    try {
      let r = await buscarTodo(fn, fp, tiempos);
      // Sin resultados: puede ser una palabra mal escrita ("piscologica"); se corrige y se repite
      // (tambien si una de las dos secciones quedo vacia: la palabra puede estar mal escrita en pocos documentos)
      if ((r.totalN === 0 || r.totalP === 0) && fn.q) {
        const nueva = await corregirConsulta(fn.q);
        if (nueva) {
          const limpio = { clavesTexto: undefined, clavesRefinar: undefined, clavesTodas: undefined, avisoTexto: undefined };
          const gn = { ...fn, q: nueva, ...limpio };
          const gp = { ...fp, q: nueva, ...limpio };
          const otra = await buscarTodo(gn, gp);
          if (otra.totalN + otra.totalP > r.totalN + r.totalP) {
            corregidaDe = fn.q;
            Object.assign(fn, gn);
            Object.assign(fp, gp);
            filtros.q = nueva;
            r = otra;
          }
        }
      }
      ({ normas, proyectos, totalN, totalP, fragN, fragP } = r);
    } catch (e) {
      error = mensajeError(e);
    }
  }

  return (
    <main className="contenedor">
      <h1>Buscar en todo</h1>
      <p className="sub">Normas legales y proyectos de ley a la vez. Puedes resumir lo encontrado con IA o seleccionar documentos para unirlos.</p>

      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/">Normas legales</a>
        <a className="atajo activo" href="/buscar">Buscar en todo</a>
        <a className="atajo" href="/proyectos">Proyectos de ley</a>
        <a className="atajo" href="/resumenes">Resúmenes diarios</a>
      </nav>

      <FormBuscar texto={fn.pregunta || fn.q} desde={fn.desde} hasta={fn.hasta} />

      {error && (
        <div className="error">
          <strong>No se pudo leer la base de datos.</strong>
          <p>{error}</p>
        </div>
      )}

      {hayBusqueda && !error && (
        <>
          {(fn.avisoTexto || fp.avisoTexto) && (
            <p className="ia-aviso">Una parte de la búsqueda dentro de los documentos tardó demasiado y se omitió; los resultados pueden estar incompletos.</p>
          )}
          {sp.sinia === "1" && (
            <p className="ia-pendiente">
              La inteligencia artificial está muy solicitada en este momento, así que se buscó por las palabras escritas.
              Puedes volver a pulsar «Buscar» en unos minutos para la búsqueda con IA.
            </p>
          )}
          {corregidaDe && (
            <p className="ia-aviso">
              Se buscó <strong>«{fn.q}»</strong> en lugar de «{corregidaDe}» (posible error de escritura).
            </p>
          )}
          <p className="resumen">
            {totalN.toLocaleString("es-PE")} normas legales · {totalP.toLocaleString("es-PE")} proyectos de ley
            {fn.q && fn.orden !== "r" && (
              <>
                {" · "}
                {fn.orden === "f" ? (
                  <>Más recientes primero · <a href={qs({ q: fn.q, desde: fn.desde, hasta: fn.hasta, t: fn.terminos.join("|"), y: fn.refinar.join("|"), pregunta: fn.pregunta, orden: "" })}>frase exacta primero</a></>
                ) : (
                  <>Frase exacta primero · <a href={qs({ q: fn.q, desde: fn.desde, hasta: fn.hasta, t: fn.terminos.join("|"), y: fn.refinar.join("|"), pregunta: fn.pregunta, orden: "f" })}>más recientes primero</a></>
                )}
              </>
            )}
          </p>
          {fn.pregunta && (
            <p className="pregunta">
              Búsqueda con IA de: <strong>«{fn.pregunta}»</strong>. Resultados ordenados por relevancia.
            </p>
          )}
          {fn.terminos.length > 0 && (
            <p className="terminos">
              <span>{fn.pregunta ? "La IA buscó:" : "Incluye también:"}</span>
              {fn.terminos.map((t) => (
                <a
                  key={t}
                  className="etq"
                  href={`/buscar${qs({ ...filtros, t: fn.terminos.filter((x) => x !== t).join("|") })}`}
                  title="Quitar este término"
                >
                  {t} ✕
                </a>
              ))}
              {!fn.pregunta && <a href={`/buscar${qs({ ...filtros, t: "" })}`}>Quitar todos</a>}
            </p>
          )}
          {fn.refinar.length > 0 && (
            <p className="terminos">
              <span>Filtrado por:</span>
              {fn.refinar.map((r) => (
                <a
                  key={r}
                  className="etq"
                  href={`/buscar${qs({ ...filtros, y: fn.refinar.filter((x) => x !== r).join("|") })}`}
                  title="Quitar este filtro"
                >
                  {r} ✕
                </a>
              ))}
              <a href={`/buscar${qs({ ...filtros, y: "" })}`}>Quitar filtros</a>
            </p>
          )}
          <FiltrarResultados ruta="/buscar" params={filtros} refinar={fn.refinar} />
          {(fn.q || fn.terminos.length > 0) && (
            <GuardarBusqueda pregunta={fn.pregunta} q={fn.pregunta ? "" : fn.q} terminos={fn.terminos} refinar={fn.refinar} />
          )}
          {fn.q && !fn.pregunta && fn.terminos.length === 0 && <BotonAmpliar q={fn.q} desde={fn.desde} hasta={fn.hasta} />}
          <BotonResumir ambito="ambos" filtros={filtros} cantidad={totalN + totalP} />

          <h2 className="seccion">Normas legales</h2>
          {normas.length === 0 ? (
            <p className="vacio">No hay normas para esta búsqueda.</p>
          ) : (
            <div className="lista">
              {normas.map((n) => {
                const nombre = [n.tipo, n.numero].filter(Boolean).join(" N° ");
                return (
                  <article className="norma" key={n.id}>
                    <div className="linea1">
                      <span className="titulo">{nombre}</span>
                      <span className="entidad">{n.entidad}</span>
                      <span className="fecha">{n.fecha}</span>
                    </div>
                    <p className="sumilla">{n.sumilla}</p>
                    <Fragmento texto={fragN[n.hash_unico]} />
                    <div className="etiquetas">
                      <Marcar tipo="N" id={n.id} etiqueta={`${nombre} (${n.fecha})`} />
                      <span className="enlaces">
                        {n.url_detalle && <a href={n.url_detalle} target="_blank" rel="noopener noreferrer">Ver</a>}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {totalN > normas.length && (
            <p className="mas"><a href={`/${qs(filtros)}`}>Ver las {totalN.toLocaleString("es-PE")} normas con más filtros →</a></p>
          )}

          <h2 className="seccion">Proyectos de ley</h2>
          {proyectos.length === 0 ? (
            <p className="vacio">No hay proyectos de ley para esta búsqueda.</p>
          ) : (
            <div className="lista">
              {proyectos.map((p) => (
                <article className="norma" key={p.id}>
                  <div className="linea1">
                    <span className="titulo">Proyecto {p.numero}</span>
                    <span className="entidad">{p.proponente}</span>
                    <span className="fecha">{p.fecha}</span>
                  </div>
                  <p className="sumilla">{p.titulo}</p>
                  {p.sumilla && <p className="entidad">{p.sumilla}</p>}
                  <Fragmento texto={fragP[claveProyecto(p)]} />
                  <div className="etiquetas">
                    <Marcar tipo="P" id={p.id} etiqueta={`Proyecto ${p.numero}`} />
                    {estadoProyecto(p) && <span className={p.ley_numero ? "etq ley" : "etq"}>{estadoProyecto(p)}</span>}
                    <span className="enlaces">
                      <a href={`/proyectos/similares?id=${p.id}`}>Similares</a>
                      {urlProyecto(p) && (
                        <>
                          {" · "}
                          <a href={urlProyecto(p)} target="_blank" rel="noopener noreferrer">Expediente</a>
                        </>
                      )}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
          {totalP > proyectos.length && (
            <p className="mas"><a href={`/proyectos${qs(filtros)}`}>Ver los {totalP.toLocaleString("es-PE")} proyectos con más filtros →</a></p>
          )}
        </>
      )}
    </main>
  );
}
