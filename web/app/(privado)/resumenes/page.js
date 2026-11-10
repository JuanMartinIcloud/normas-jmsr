import { exigirUsuario } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { cargarResumen, fechasConResumen, fechaLarga } from "../../../lib/resumenes";
import ResumenIA from "../../ResumenIA";

export const dynamic = "force-dynamic";

export const metadata = { title: "Resúmenes diarios · Normas Legales del Perú" };

export default async function Resumenes({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const pedida = typeof searchParams?.fecha === "string" ? searchParams.fecha.trim() : "";

  let resumen = null;
  let fechas = [];
  let error = "";
  try {
    fechas = await fechasConResumen(90);
    // Sin fecha pedida se muestra el mas reciente de la lista
    const elegida = pedida || (fechas[0] ? fechas[0].fecha : "");
    resumen = elegida ? await cargarResumen(elegida) : null;
  } catch (e) {
    error = mensajeError(e);
  }

  return (
    <main className="contenedor">
      <h1>Resúmenes diarios</h1>
      <p className="sub">Lo publicado cada día en El Peruano y las novedades de los proyectos de ley, resumido con IA.</p>

      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/">Normas legales</a>
        <a className="atajo activo" href="/resumenes">Resúmenes diarios</a>
        <a className="atajo" href="/proyectos">Proyectos de ley</a>
      </nav>

      {error ? (
        <div className="error">
          <strong>No se pudo leer la base de datos.</strong>
          <p>{error}</p>
        </div>
      ) : (
        <>
          {fechas.length > 0 && (
            <div className="panel">
              <h2>Elige un día</h2>
              <div className="anios">
                {fechas.map((r) => (
                  <a
                    key={r.fecha}
                    className={`atajo ${resumen && resumen.fecha === r.fecha ? "activo" : ""}`}
                    href={`/resumenes?fecha=${r.fecha}`}
                    title={fechaLarga(r.fecha)}
                  >
                    {r.fecha.slice(8, 10)}/{r.fecha.slice(5, 7)}/{r.fecha.slice(0, 4)}
                  </a>
                ))}
              </div>
            </div>
          )}

          {resumen ? (
            <ResumenIA resumen={resumen} />
          ) : (
            <p className="vacio">
              {pedida
                ? "No hay resumen para esa fecha."
                : "Todavía no hay resúmenes. El primero se genera en la madrugada siguiente a la instalación."}
            </p>
          )}
        </>
      )}
    </main>
  );
}
