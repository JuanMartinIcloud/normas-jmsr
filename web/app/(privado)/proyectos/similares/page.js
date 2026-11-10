import { exigirUsuario } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { consultarGuardado } from "../../../../lib/db";
import { urlProyecto } from "../../../../lib/resumenes";
import { colsLey, estadoProyecto } from "../../../../lib/leyes";
import Marcar from "../../../Marcar";

export const metadata = { title: "Proyectos similares · Normas Legales del Perú" };

// Palabras que aparecen en casi todos los titulos de proyectos: no sirven para decidir si dos se parecen
const GENERICAS = `ley leyes proyecto proposicion proposición legislativa legislativo modifica modificar modificación artículo articulo
  artículos decreto decretos establece establecer nacional numeral incorpora incorporar regula regular pública público publica
  fin marco general norma normas sistema perú peru república congreso declara declarar interés necesidad año años texto único
  ordenado supremo disposición complementaria final transitoria actualización conformidad segunda reglamento garantizar
  fortalecer promover mediante dispone aprueba deroga crea crear diversas diversos medidas objeto aplicación caso
  actualizacion cámara diputados senado pl cr cd`;

// Proyectos cuyo titulo comparte mas palabras importantes con el elegido
async function buscarSimilares(id) {
  const [base] = await consultarGuardado(
    `SELECT id::text AS id, numero, periodo, camara, num_pley, url, fecha_presentacion::text AS fecha,
            titulo, proponente, estado, ${colsLey("proyectos_ley")}
     FROM proyectos_ley WHERE id = $1`,
    [id]
  );
  if (!base) return { base: null, similares: [] };
  // Parecido = que parte de las palabras distintivas del titulo elegido aparece en el otro titulo.
  // Se descartan las palabras que traen casi todos los proyectos ("ley", "modifica", "articulo", etc.),
  // para que no salgan como parecidos proyectos que solo comparten esas palabras.
  const similares = await consultarGuardado(
    `WITH b AS (
       SELECT ARRAY(SELECT unnest(tsvector_to_array(to_tsvector('spanish', $1)))
                    EXCEPT SELECT unnest(tsvector_to_array(to_tsvector('spanish', $3)))) AS lx
     ),
     c AS (
       SELECT p.id, p.numero, p.periodo, p.camara, p.num_pley, p.url, p.fecha_presentacion, p.titulo, p.proponente, p.estado,
              ${colsLey("p")},
              (SELECT count(*) FROM unnest(tsvector_to_array(to_tsvector('spanish', coalesce(p.titulo,'')))) w
                WHERE w = ANY(b.lx)) AS comunes,
              cardinality(b.lx) AS total
       FROM proyectos_ley p, b
       WHERE p.id <> $2 AND cardinality(b.lx) > 0
         AND to_tsvector('spanish', coalesce(p.titulo,'')) @@ array_to_string(ARRAY(SELECT quote_literal(x) FROM unnest(b.lx) x), ' | ')::tsquery
     )
     SELECT id::text AS id, numero, periodo, camara, num_pley, url, fecha_presentacion::text AS fecha,
            titulo, proponente, estado, ley_tipo, ley_numero, ley_fecha, ley_docs, enlace_numero, enlace_camara, enlace_estado,
            comunes::float / total AS parecido
     FROM c
     WHERE comunes >= LEAST(total, GREATEST(2, LEAST(4, CEIL(total * 0.35))))
     ORDER BY comunes DESC, fecha_presentacion DESC NULLS LAST
     LIMIT 25`,
    [base.titulo || "", id, GENERICAS]
  );
  return { base, similares };
}

function Tarjeta({ p, extra }) {
  return (
    <article className="norma">
      <div className="linea1">
        <span className="titulo">Proyecto {p.numero}</span>
        <span className="entidad">{p.proponente}</span>
        <span className="fecha">{p.fecha}</span>
      </div>
      <p className="sumilla">{p.titulo}</p>
      <div className="etiquetas">
        <Marcar tipo="P" id={p.id} etiqueta={`Proyecto ${p.numero}`} />
        {estadoProyecto(p) && <span className={p.ley_numero ? "etq ley" : "etq"}>{estadoProyecto(p)}</span>}
        {extra}
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
  );
}

export default async function Similares({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const id = /^\d{1,18}$/.test(String(searchParams?.id || "")) ? String(searchParams.id) : "";
  let datos = { base: null, similares: [] };
  let error = "";
  if (id) {
    try {
      datos = await buscarSimilares(id);
    } catch (e) {
      error = mensajeError(e);
    }
  }

  return (
    <main className="contenedor">
      <h1>Proyectos similares</h1>
      <p className="sub">
        Proyectos cuyo título trata lo mismo que el elegido. Marca los que quieras y pulsa «Proponer proyecto unificado» en la barra de abajo.
      </p>
      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/proyectos">← Proyectos de ley</a>
        <a className="atajo" href="/buscar">Buscar en todo</a>
      </nav>

      {error && (
        <div className="error">
          <strong>No se pudo leer la base de datos.</strong>
          <p>{error}</p>
        </div>
      )}
      {!error && !datos.base && <p className="vacio">No se encontró el proyecto.</p>}
      {datos.base && (
        <>
          <h2 className="seccion">Proyecto elegido</h2>
          <div className="lista">
            <Tarjeta p={datos.base} />
          </div>
          <h2 className="seccion">Parecidos ({datos.similares.length})</h2>
          {datos.similares.length === 0 ? (
            <p className="vacio">No se encontraron proyectos parecidos.</p>
          ) : (
            <div className="lista">
              {datos.similares.map((p) => (
                <Tarjeta
                  key={p.id}
                  p={p}
                  extra={
                    <span className="etq gris">
                      Parecido {Math.round(Number(p.parecido) * 100)}%
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
