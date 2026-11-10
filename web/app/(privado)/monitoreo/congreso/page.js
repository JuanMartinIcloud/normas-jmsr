import AvisoMes from "../AvisoMes";
import { exigirUsuario } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { leerFiltrosMonitoreo, reporteCongreso, opcionesFiltros, ayerLima, fechaLarga } from "../../../../lib/monitoreo";
import { urlProyecto } from "../../../../lib/resumenes";
import Filtros from "../Filtros";
import Tarjeta from "../Tarjeta";
import { enlacesLey, estadoProyecto, recorrido } from "../../../../lib/leyes";

export const metadata = { title: "Congreso · Monitoreo empresarial" };

const CAMARA = { D: "Cámara de Diputados", S: "Senado", C: "Congreso" };

function Seccion({ titulo, datos, vacio, mostrarMovimiento }) {
  const { items, cuenta } = datos;
  return (
    <>
      <h3 className="seccion">{titulo}</h3>
      <p className="ia-pendiente">
        {cuenta.total} en total · {cuenta.relevantes} con impacto empresarial
        {cuenta.pendientes > 0 && ` · ${cuenta.pendientes} aún en análisis`}
      </p>
      {items.length === 0 ? (
        <p className="vacio">{cuenta.total ? "Ninguno con impacto empresarial (o todos fueron quitados)." : vacio}</p>
      ) : (
        <div className="lista">
          {items.map((p) => (
            <Tarjeta
              key={`${p.analisis_id}-${p.mov_fecha}`}
              a={p}
              titulo={`Proposición ${p.numero}`}
              subtitulo={[CAMARA[p.camara], p.proponente].filter((x, i, l) => x && l.indexOf(x) === i).join(" · ")}
              fecha={p.mov_fecha || p.fecha_presentacion}
              descripcion={p.titulo}
              movimiento={[
                mostrarMovimiento
                  ? [p.mov_comisiones && `Comisión: ${p.mov_comisiones}`, p.mov_detalle].filter(Boolean).join(" · ")
                  : `Estado actual: ${estadoProyecto(p) || "—"}`,
                mostrarMovimiento && p.ley_numero ? estadoProyecto(p) : "",
                recorrido(p),
              ].filter(Boolean).join(" · ")}
              enlaces={[{ texto: "Expediente", url: urlProyecto(p) }, ...enlacesLey(p)]}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default async function CongresoMonitoreo({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const f = leerFiltrosMonitoreo(searchParams || {});
  const fecha = f.fecha || ayerLima();
  f.fecha = fecha;
  let r = null;
  let opciones = { sectores: [] };
  let error = "";
  try {
    [r, opciones] = await Promise.all([reporteCongreso(f, fecha, fecha), opcionesFiltros(fecha, fecha)]);
  } catch (e) {
    error = mensajeError(e);
  }
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(searchParams || {}).filter(([, v]) => typeof v === "string" && v)), fecha }).toString();

  return (
    <>
      <h1>Reporte del Congreso · {fechaLarga(fecha)}</h1>
      <AvisoMes mes={fecha.slice(0, 7)} />
      <p className="sub">
        Proposiciones legislativas ingresadas, dictámenes de comisiones, autógrafas y leyes publicadas del día, con su análisis de impacto
        empresarial. El reporte de cada día está listo a las 7:00 a. m. del día siguiente.
      </p>
      <Filtros accion="/monitoreo/congreso" f={f} sectores={opciones.sectores} periodo="dia" />
      {error && <div className="error"><strong>No se pudo leer el reporte.</strong><p>{error}</p></div>}
      {r && (
        <>
          <p className="resumen">
            <a href={`/api/monitoreo/csv?vista=congreso&${qs}`}>Descargar en Excel</a>
          </p>
          <h2 className="seccion">Sección 1 · Cámara de Diputados</h2>
          <Seccion titulo="Proposiciones legislativas ingresadas" datos={r.diputados_ingresadas} vacio="No ingresaron proposiciones este día." />
          <Seccion titulo="Dictámenes emitidos por las comisiones" datos={r.diputados_dictamenes} vacio="No hubo dictámenes este día." mostrarMovimiento />
          <h2 className="seccion">Sección 2 · Cámara de Senadores</h2>
          <Seccion titulo="Proposiciones legislativas ingresadas" datos={r.senado_ingresadas} vacio="No ingresaron proposiciones al Senado este día." mostrarMovimiento />
          <Seccion titulo="Dictámenes emitidos por las comisiones" datos={r.senado_dictamenes} vacio="No hubo dictámenes en el Senado este día." mostrarMovimiento />
          <h2 className="seccion">Sección 3 · Autógrafas de ley</h2>
          <Seccion titulo="Autógrafas" datos={r.autografas} vacio="No hubo autógrafas este día." mostrarMovimiento />
          <h2 className="seccion">Sección 4 · Leyes publicadas</h2>
          <Seccion titulo="Proposiciones convertidas en ley" datos={r.publicadas} vacio="No se publicaron leyes de proposiciones este día." mostrarMovimiento />
        </>
      )}
    </>
  );
}
