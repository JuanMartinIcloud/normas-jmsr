import { coberturaArea, cifrasArea, reporteArea, estimarMinutos, pedidoAbierto } from "../../../lib/areas";
import { nombreMes, hoyLima } from "../../../lib/monitoreo";
import BotonRevisarMes from "./BotonRevisarMes";

const COLOR = { Favorable: "favorable", Desfavorable: "desfavorable", "Para seguimiento": "seguimiento" };
const CAMARA = { D: "Cámara de Diputados", S: "Senado", C: "Congreso" };

// Reporte de un area en un mes (lo usan la pagina de un area y la de varias areas)
export default async function ReporteArea({ area, f, conFiltros = true }) {
  const [cob, cifras, filas, pedido] = await Promise.all([
    coberturaArea(area.id, f.mes),
    cifrasArea(area.id, f.mes),
    reporteArea(area.id, f),
    pedidoAbierto(area.id, f.mes),
  ]);
  const estimado = cob.faltan ? await estimarMinutos(area.id, cob.faltan) : 0;
  const actual = f.mes === hoyLima().slice(0, 7);
  return (
    <section className="reporte-area">
      {cob.faltan > 0 && (
        <div className="ia-pendiente">
          {actual && !pedido ? (
            <>
              La IA revisa el mes en curso cada noche; faltan {cob.faltan.toLocaleString("es-PE")} documentos de{" "}
              {cob.total.toLocaleString("es-PE")} (lo más reciente).{" "}
            </>
          ) : (
            <>
              La IA todavía no ha revisado todo {nombreMes(f.mes)} para esta área: faltan {cob.faltan.toLocaleString("es-PE")}{" "}
              documentos de {cob.total.toLocaleString("es-PE")}.{" "}
            </>
          )}
          <BotonRevisarMes area={area.id} mes={f.mes} estimado={estimado} pedido={pedido} />
        </div>
      )}
      <div className="cifras-area">
        <span><strong>{cifras.total}</strong> documentos afectan al área</span>
        <span className="etq cal-favorable">{cifras.favorables} favorables</span>
        <span className="etq cal-desfavorable">{cifras.desfavorables} desfavorables</span>
        <span className="etq cal-seguimiento">{cifras.seguimiento} para seguimiento</span>
        <span className="etq gris">{cifras.altos} de impacto alto</span>
        <span className="etq gris">{cifras.normas} normas · {cifras.proyectos} proyectos de ley</span>
      </div>
      {conFiltros && (
        <form className="filtros" method="get">
          <label>
            Mes
            <input type="month" name="mes" defaultValue={f.mes} min="2015-01" max={hoyLima().slice(0, 7)} />
          </label>
          <label>
            Calificación
            <select name="calificacion" defaultValue={f.calificacion}>
              <option value="">Todas</option>
              <option>Favorable</option>
              <option>Desfavorable</option>
              <option>Para seguimiento</option>
            </select>
          </label>
          <label>
            Impacto
            <select name="impacto" defaultValue={f.impacto}>
              <option value="">Todos</option>
              <option>Alto</option>
              <option>Moderado</option>
              <option>Bajo</option>
            </select>
          </label>
          <label>
            Documentos
            <select name="tipo" defaultValue={f.tipo}>
              <option value="">Normas y proyectos</option>
              <option value="N">Solo normas legales</option>
              <option value="P">Solo proyectos de ley</option>
            </select>
          </label>
          <button className="boton" type="submit">Ver</button>
        </form>
      )}
      {!filas.length && <p className="resumen">No hay documentos que afecten a esta área con estos filtros.</p>}
      <div className="lista">
        {filas.map((d) => {
          const esNorma = d.tipo === "N";
          const titulo = esNorma
            ? [d.n_tipo, d.n_numero].filter(Boolean).join(" N° ")
            : `Proyecto de ley ${d.p_numero}${d.ley_numero ? ` · ya es ${d.ley_tipo || "Ley"} N° ${d.ley_numero}` : ""}`;
          return (
            <article key={`${d.tipo}${d.ref_id}`} className="norma tarjeta-mon">
              <div className="linea1">
                <span className="titulo">{titulo}</span>
                <span className="entidad">{esNorma ? d.entidad : CAMARA[d.camara] || d.camara}</span>
                <span className="fecha">{d.fecha}</span>
              </div>
              <p className="sumilla">{esNorma ? d.sumilla : d.titulo}</p>
              {!esNorma && d.estado && <p className="movimiento">Estado: {d.estado}</p>}
              <div className="etiquetas">
                <span className={`etq cal-${COLOR[d.calificacion] || "seguimiento"}`}>{d.calificacion}</span>
                <span className="etq gris">Impacto {String(d.impacto || "").toLowerCase()} · {d.puntaje}/10</span>
                {d.lectura === "sumilla" && <span className="etq gris">Analizado solo con la sumilla</span>}
              </div>
              <dl className="analisis">
                <dt>En qué consiste</dt>
                <dd>{d.resumen}</dd>
                {d.cambios && (
                  <>
                    <dt>Qué cambia</dt>
                    <dd>{d.cambios}</dd>
                  </>
                )}
                <dt>Cómo afecta a {area.nombre.toLowerCase()}</dt>
                <dd>{d.comentario}</dd>
              </dl>
              <div className="etiquetas">
                <span className="enlaces">
                  {esNorma
                    ? d.url_detalle && <a href={d.url_detalle} target="_blank" rel="noopener noreferrer">Ver en El Peruano</a>
                    : d.p_url && <a href={d.p_url} target="_blank" rel="noopener noreferrer">Ver expediente</a>}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
