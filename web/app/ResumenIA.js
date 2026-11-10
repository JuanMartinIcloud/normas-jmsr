import { fechaLarga } from "../lib/resumenes";

function cantidad(n, singular, plural) {
  return `${Number(n || 0).toLocaleString("es-PE")} ${Number(n) === 1 ? singular : plural}`;
}

// Enlaces a las normas y proyectos que cita cada punto del resumen
function Referencias({ refs, referencias }) {
  const lista = (refs || []).map((r) => ({ codigo: r, ...(referencias[r] || {}) })).filter((r) => r.texto);
  if (!lista.length) return null;
  return (
    <span className="ia-refs">
      {lista.map((r) =>
        r.url ? (
          <a key={r.codigo} className="ia-ref" href={r.url} target="_blank" rel="noopener noreferrer">
            {r.texto}
          </a>
        ) : (
          <span key={r.codigo} className="ia-ref">{r.texto}</span>
        )
      )}
    </span>
  );
}

function Puntos({ lista, referencias }) {
  return (
    <ul className="ia-puntos">
      {lista.map((p, i) => (
        <li key={i}>
          {p.texto} <Referencias refs={p.refs} referencias={referencias} />
        </li>
      ))}
    </ul>
  );
}

export default function ResumenIA({ resumen, abierto = true, enlaces = true }) {
  const { fecha, datos, referencias, n_normas, n_proyectos, n_cambios } = resumen;
  const destacadas = datos.destacadas || [];
  const temas = datos.temas || [];
  const proyectos = datos.proyectos || [];
  const avances = datos.avances || [];

  return (
    <section className="ia">
      <details open={abierto}>
        <summary>
          <span className="ia-titulo">Resumen del {fechaLarga(fecha)}</span>
          <span className="ia-cifras">
            {cantidad(n_normas, "norma", "normas")} · {cantidad(n_proyectos, "proyecto nuevo", "proyectos nuevos")}
            {n_cambios ? ` · ${cantidad(n_cambios, "cambio de estado", "cambios de estado")}` : ""}
          </span>
        </summary>

        {(datos.avisos || []).map((a, i) => (
          <p key={i} className="ia-aviso">{a}</p>
        ))}

        {datos.panorama && <p className="ia-panorama">{datos.panorama}</p>}

        {destacadas.length > 0 && (
          <>
            <h3>Lo más importante</h3>
            <div className="ia-destacadas">
              {destacadas.map((d, i) => (
                <div key={i} className="ia-destacada">
                  {d.titulo && <strong>{d.titulo}</strong>}
                  {d.explicacion && <p>{d.explicacion}</p>}
                  <Referencias refs={d.refs} referencias={referencias} />
                </div>
              ))}
            </div>
          </>
        )}

        {temas.map((t, i) => (
          <div key={i}>
            <h3>{t.tema}</h3>
            <Puntos lista={t.puntos || []} referencias={referencias} />
          </div>
        ))}

        {datos.designaciones && (
          <>
            <h3>Designaciones y personal</h3>
            <p>{datos.designaciones}</p>
          </>
        )}

        {proyectos.length > 0 && (
          <>
            <h3>Proyectos de ley nuevos</h3>
            <Puntos lista={proyectos} referencias={referencias} />
          </>
        )}

        {avances.length > 0 && (
          <>
            <h3>Proyectos que avanzaron</h3>
            <Puntos lista={avances} referencias={referencias} />
          </>
        )}

        <p className="ia-nota">
          Resumen elaborado con inteligencia artificial a partir de las sumillas y títulos oficiales.
          Antes de usarlo, revisa el texto de la norma.
        </p>
        {enlaces && (
          <div className="acciones">
            <a className="boton sec" href={`/?fecha=${fecha}`}>Ver las normas de ese día</a>
            <a className="boton sec" href="/resumenes">Resúmenes anteriores</a>
          </div>
        )}
      </details>
    </section>
  );
}
