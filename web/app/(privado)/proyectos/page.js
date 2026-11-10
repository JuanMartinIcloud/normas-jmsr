import { exigirUsuario } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { consultarGuardado, POR_PAGINA, prepararBusqueda, corregirConsulta } from "../../../lib/db";
import { fragmentos, claveProyecto } from "../../../lib/textos";
import Fragmento from "../../Fragmento";
import { urlProyecto } from "../../../lib/resumenes";
import { leerFiltrosProyectos, whereProyectos, ordenProyectos } from "../../../lib/proyectos";
import FiltrarResultados from "../buscar/FiltrarResultados";
import BotonResumir from "../../BotonResumir";
import Marcar from "../../Marcar";
import { colsLey, enlacesLey, estadoProyecto, recorrido } from "../../../lib/leyes";

export const dynamic = "force-dynamic";

function enlace(f, cambios = {}) {
  const base = { ...f, ...cambios };
  const qs = new URLSearchParams();
  for (const k of ["q", "periodo", "estado", "rubro", "proponente", "desde", "hasta"]) {
    if (base[k]) qs.set(k, base[k]);
  }
  if (base.terminos && base.terminos.length) qs.set("t", base.terminos.join("|"));
  if (base.refinar && base.refinar.length) qs.set("y", base.refinar.join("|"));
  if (base.pregunta) qs.set("pregunta", base.pregunta);
  if (base.orden) qs.set("orden", base.orden);
  if (base.pagina > 1) qs.set("p", String(base.pagina));
  const s = qs.toString();
  return s ? `/proyectos?${s}` : "/proyectos";
}

async function cargar(f) {
  await prepararBusqueda(f, "P");
  const { where, params } = whereProyectos(f);
  const pLista = [...params];
  const orden = ordenProyectos(f, pLista);
  const offset = (f.pagina - 1) * POR_PAGINA;
  const [resumen, periodos, estados, rubros, proponentes, filas, total] = await Promise.all([
    consultarGuardado(`SELECT count(*)::int AS total, min(fecha_presentacion)::text AS primera, max(fecha_presentacion)::text AS ultima FROM proyectos_ley`, [], "catalogos"),
    consultarGuardado(`SELECT periodo AS valor, count(*)::int AS n FROM proyectos_ley GROUP BY 1 ORDER BY 1 DESC`, [], "catalogos"),
    consultarGuardado(
      `SELECT '__ley' AS valor, 'Convertidas en ley' AS etiqueta, count(*)::int AS n FROM proyectos_ley WHERE ley_numero IS NOT NULL
       UNION ALL
       (SELECT estado, estado, count(*)::int FROM proyectos_ley WHERE estado IS NOT NULL GROUP BY 1 ORDER BY 3 DESC)`, [], "catalogos"
    ),
    consultarGuardado(`SELECT rubro AS valor, count(*)::int AS n FROM proyectos_ley WHERE rubro IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, [], "catalogos"),
    consultarGuardado(`SELECT proponente AS valor, count(*)::int AS n FROM proyectos_ley WHERE proponente IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 30`, [], "catalogos"),
    consultarGuardado(
      `SELECT id, periodo, camara, numero, num_pley, url, fecha_presentacion::text AS fecha, titulo, sumilla, autor, proponente, estado, rubro,
              ${colsLey("proyectos_ley")}
       FROM proyectos_ley ${where} ORDER BY ${orden} LIMIT ${POR_PAGINA} OFFSET ${offset}`,
      pLista
    ),
    consultarGuardado(`SELECT count(*)::int AS n FROM proyectos_ley ${where}`, params),
  ]);
  let frags = {};
  try {
    frags = await fragmentos("P", filas.map(claveProyecto), [f.q, ...f.terminos, ...f.refinar]);
  } catch (e) {
    frags = {};
  }
  return { resumen: resumen[0], periodos, estados, rubros, proponentes, filas, total: total[0].n, frags };
}

function Opciones({ lista }) {
  return (
    <>
      <option value="">Todos</option>
      {lista.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta || o.valor} ({o.n.toLocaleString("es-PE")})
        </option>
      ))}
    </>
  );
}

export default async function Proyectos({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const f = leerFiltrosProyectos(searchParams || {});
  let datos;
  let corregidaDe = "";
  try {
    datos = await cargar(f);
    // Sin resultados: puede ser una palabra mal escrita; se corrige y se repite la busqueda
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
        <h1>Proyectos de ley</h1>
        <div className="error">
          <strong>No se pudo leer la base de datos.</strong>
          <p>{mensajeError(e)}</p>
        </div>
      </main>
    );
  }

  const { resumen, periodos, estados, rubros, proponentes, filas, total, frags } = datos;
  const paginas = Math.min(100, Math.max(1, Math.ceil(total / POR_PAGINA))); // se navega hasta la pagina 100 (para mas, afinar la busqueda)

  return (
    <main className="contenedor">
      <h1>Proyectos de ley</h1>
      <p className="sub">
        {resumen.total.toLocaleString("es-PE")} proyectos guardados
        {resumen.primera ? ` · presentados entre ${resumen.primera} y ${resumen.ultima}` : ""}
      </p>

      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/">Normas legales</a>
        <a className="atajo activo" href="/proyectos">Proyectos de ley</a>
        <a className="atajo" href="/resumenes">Resúmenes diarios</a>
        <a className="atajo" href="/buscar">Buscar en todo</a>
      </nav>

      <form className="filtros" method="get" action="/proyectos">
        <label className="ancho">
          Buscar por palabra, autor o número
          <input type="search" name="q" defaultValue={f.q} placeholder="Ej.: pensiones, Luque, 14864/2025-CR" />
        </label>
        <label>
          Periodo parlamentario
          <select name="periodo" defaultValue={f.periodo}><Opciones lista={periodos} /></select>
        </label>
        <label>
          Estado
          <select name="estado" defaultValue={f.estado}><Opciones lista={estados} /></select>
        </label>
        <label>
          Rubro
          <select name="rubro" defaultValue={f.rubro}><Opciones lista={rubros} /></select>
        </label>
        <label>
          Quién lo propone
          <select name="proponente" defaultValue={f.proponente}><Opciones lista={proponentes} /></select>
        </label>
        <label>
          Presentado desde
          <input type="date" name="desde" defaultValue={f.desde} />
        </label>
        <label>
          Presentado hasta
          <input type="date" name="hasta" defaultValue={f.hasta} />
        </label>
        <div className="acciones">
          <button className="boton" type="submit">Buscar</button>
          <a className="boton sec" href="/proyectos">Limpiar</a>
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
      {(f.q || f.terminos.length > 0 || f.refinar.length > 0 || f.periodo || f.estado || f.rubro || f.proponente || f.desde || f.hasta) && (
        <FiltrarResultados
          ruta="/proyectos"
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

      {(f.q || f.periodo || f.estado || f.rubro || f.proponente || f.desde || f.hasta || f.terminos.length > 0 || f.refinar.length > 0) && (
        <BotonResumir
          ambito="proyectos"
          cantidad={total}
          filtros={{
            q: f.q, periodo: f.periodo, estado: f.estado, rubro: f.rubro,
            proponente: f.proponente, desde: f.desde, hasta: f.hasta, t: f.terminos.join("|"),
            y: f.refinar.join("|"), orden: f.orden,
          }}
        />
      )}

      {filas.length === 0 ? (
        <p className="vacio">No hay proyectos para esta búsqueda.</p>
      ) : (
        <div className="lista">
          {filas.map((n) => (
            <article className="norma" key={n.id}>
              <div className="linea1">
                <span className="titulo">Proyecto {n.numero}</span>
                <span className="entidad">{n.proponente}</span>
                <span className="fecha">{n.fecha}</span>
              </div>
              <p className="sumilla">{n.titulo}</p>
              {n.sumilla && <p className="entidad">{n.sumilla}</p>}
              <Fragmento texto={frags[claveProyecto(n)]} />
              {n.autor && <p className="entidad">Autores: {n.autor}</p>}
              {recorrido(n) && <p className="entidad">{recorrido(n)}</p>}
              <div className="etiquetas">
                <Marcar tipo="P" id={String(n.id)} etiqueta={`Proyecto ${n.numero}`} />
                {estadoProyecto(n) && <span className={n.ley_numero ? "etq ley" : "etq"}>{estadoProyecto(n)}</span>}
                {n.rubro && <span className="etq gris">{n.rubro}</span>}
                <span className="etq gris">Periodo {n.periodo}</span>
                <span className="enlaces">
                  <a href={`/proyectos/similares?id=${n.id}`}>Similares</a>
                  {urlProyecto(n) && (
                    <>
                      {" · "}
                      <a href={urlProyecto(n)} target="_blank" rel="noopener noreferrer">Ver expediente</a>
                    </>
                  )}
                  {enlacesLey(n).map((e) => (
                    <span key={e.url}>
                      {" · "}
                      <a href={e.url} target="_blank" rel="noopener noreferrer">{e.texto}</a>
                    </span>
                  ))}
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
