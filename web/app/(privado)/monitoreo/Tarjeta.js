import BotonQuitar from "./BotonQuitar";

const COLOR = { Favorable: "favorable", Desfavorable: "desfavorable", "Para seguimiento": "seguimiento" };

// Tarjeta de un documento analizado (norma o proyecto)
export default function Tarjeta({ titulo, subtitulo, fecha, enlaces = [], descripcion, movimiento, a }) {
  return (
    <article className={`norma tarjeta-mon ${a.excluido ? "quitado" : ""}`}>
      <div className="linea1">
        <span className="titulo">{titulo}</span>
        {subtitulo && <span className="entidad">{subtitulo}</span>}
        {fecha && <span className="fecha">{fecha}</span>}
      </div>
      {descripcion && <p className="sumilla">{descripcion}</p>}
      {movimiento && <p className="movimiento">{movimiento}</p>}
      <div className="etiquetas">
        <span className={`etq cal-${COLOR[a.calificacion] || "seguimiento"}`}>{a.calificacion}</span>
        <span className="etq gris">
          Impacto {String(a.impacto || "").toLowerCase()}
          {a.puntaje ? ` · ${a.puntaje}/10` : ""}
        </span>
        <span className="etq gris">{a.sector}</span>
        {(a.comites || []).map((c) => (
          <span key={c} className="etq gris">Comité {c}</span>
        ))}
      </div>
      <dl className="analisis">
        <dt>En qué consiste</dt>
        <dd>{a.resumen}</dd>
        <dt>Qué cambia</dt>
        <dd>{a.cambios}</dd>
        <dt>Impacto en el sector empresarial y el clima de inversiones</dt>
        <dd>{a.comentario}</dd>
        {(a.acciones || []).length > 0 && (
          <>
            <dt>Acciones sugeridas a los comités</dt>
            <dd>
              <ul>
                {a.acciones.map((x, i) => (
                  <li key={i}>
                    <strong>{x.comite}:</strong> {x.accion}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {a.accion_directorio && (
          <>
            <dt>Acción sugerida al Directorio</dt>
            <dd>{a.accion_directorio}</dd>
          </>
        )}
      </dl>
      <div className="etiquetas">
        <BotonQuitar id={a.analisis_id} excluido={a.excluido} />
        {a.excluido && a.excluido_por && <span className="etq gris">Quitado por {a.excluido_por}</span>}
        {a.lectura === "sumilla" && <span className="etq gris">Analizado solo con la sumilla</span>}
        <span className="enlaces">
          {enlaces.filter((e) => e.url).map((e, i) => (
            <span key={e.texto}>
              {i > 0 && " · "}
              <a href={e.url} target="_blank" rel="noopener noreferrer">{e.texto}</a>
            </span>
          ))}
        </span>
      </div>
    </article>
  );
}
