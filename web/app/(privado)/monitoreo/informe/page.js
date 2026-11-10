import { mensajeError } from "../../../../lib/errores";
import { usuarioActual, exigirUsuario } from "../../../../lib/auth";
import { datosInforme, htmlInforme } from "../../../../lib/informe";
import { correoConfigurado, leerDestinatarios } from "../../../../lib/correo";
import { ayerLima, fechaLarga, COMITES } from "../../../../lib/monitoreo";
import AccionesInforme from "./AccionesInforme";
import Destinatarios from "./Destinatarios";

export const metadata = { title: "Informe y envío · Monitoreo empresarial" };

export default async function Informe({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const sp = searchParams || {};
  const fecha = typeof sp.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : ayerLima();
  const u = await usuarioActual();
  let d = null;
  let dest = { general: [], comites: {} };
  let error = "";
  try {
    [d, dest] = await Promise.all([datosInforme(fecha), leerDestinatarios()]);
  } catch (e) {
    error = mensajeError(e);
  }
  // Vista previa: el correo general o el que recibe un comite (?comite=...)
  const comite = typeof sp.comite === "string" && COMITES.includes(sp.comite) ? sp.comite : null;
  const vista = d ? htmlInforme(d, comite) : null;
  const porComite = d
    ? COMITES.map((c) => ({ c, n: htmlInforme(d, c).total, correos: (dest.comites[c] || []).length })).filter((x) => x.n || x.correos)
    : [];

  return (
    <>
      <h1>Informe diario · {fechaLarga(fecha)}</h1>
      <p className="sub">
        Revisa el informe del día. Para quitar un ítem, hazlo en <a href={`/monitoreo/normas?mes=${fecha.slice(0, 7)}`}>Normas legales</a> o{" "}
        <a href={`/monitoreo/congreso?fecha=${fecha}`}>Congreso</a>. Luego apruébalo y envíalo: cada comité recibe solo lo que le corresponde.
      </p>
      <form className="filtros" method="get" action="/monitoreo/informe">
        <label>
          Día
          <input type="date" name="fecha" defaultValue={fecha} />
        </label>
        <div className="acciones"><button className="boton" type="submit">Ver</button></div>
      </form>
      {error && <div className="error"><strong>No se pudo armar el informe.</strong><p>{error}</p></div>}
      {d && (
        <>
          <AccionesInforme
            fecha={fecha}
            estado={d.estado}
            correoListo={correoConfigurado()}
            hayDestinatarios={dest.general.length > 0 || Object.keys(dest.comites).length > 0}
            total={vista.total}
          />
          {porComite.length > 0 && (
            <div className="envoltura-tabla">
              <table className="tabla-mon">
                <thead><tr><th>Comité</th><th className="num">Ítems en el informe</th><th className="num">Destinatarios</th></tr></thead>
                <tbody>
                  {porComite.map((x) => (
                    <tr key={x.c}>
                      <td><a href={`/monitoreo/informe?fecha=${fecha}&comite=${encodeURIComponent(x.c)}#vista`}>{x.c}</a></td>
                      <td className="num">{x.n}</td><td className="num">{x.correos || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2 className="seccion" id="vista">
            {comite ? `Vista previa del correo al comité ${comite}` : "Vista previa del correo general"} ({vista.total} ítems)
          </h2>
          {comite && <p className="ia-pendiente"><a href={`/monitoreo/informe?fecha=${fecha}#vista`}>← Ver el correo general</a></p>}
          {!comite && porComite.length > 0 && (
            <p className="ia-pendiente">Para ver el correo que recibe cada comité, pulsa su nombre en la tabla de arriba.</p>
          )}
          <div className="grafico" dangerouslySetInnerHTML={{ __html: vista.html }} />
          {u?.rol === "admin" && <Destinatarios general={dest.general} comites={dest.comites} lista={COMITES} />}
        </>
      )}
    </>
  );
}
