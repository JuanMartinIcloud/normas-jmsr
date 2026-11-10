import AvisoMes from "../AvisoMes";
import { exigirUsuario } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { leerFiltrosMonitoreo, normasAnalizadas, avanceNormas, opcionesFiltros, finDeMes, nombreMes, hoyLima } from "../../../../lib/monitoreo";
import Filtros from "../Filtros";
import Tarjeta from "../Tarjeta";

export const metadata = { title: "Normas legales · Monitoreo empresarial" };

export default async function NormasMonitoreo({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const f = leerFiltrosMonitoreo(searchParams || {});
  const desde = `${f.mes}-01`;
  const hasta = finDeMes(f.mes);
  let filas = [];
  let avance = null;
  let opciones = { sectores: [], tipos: [] };
  let error = "";
  try {
    [filas, avance, opciones] = await Promise.all([normasAnalizadas(f, desde, hasta), avanceNormas(desde, hasta), opcionesFiltros(desde, hasta)]);
  } catch (e) {
    error = mensajeError(e);
  }
  const esMesActual = f.mes === hoyLima().slice(0, 7);
  const qs = new URLSearchParams(Object.entries(searchParams || {}).filter(([, v]) => typeof v === "string" && v)).toString();

  return (
    <>
      <h1>Normas legales que afectan al sector empresarial · {nombreMes(f.mes)}</h1>
      <AvisoMes mes={f.mes} />
      <p className="sub">
        Normas publicadas en El Peruano que afectan a las empresas, a sectores económicos o al clima de inversiones,
        analizadas con IA. {esMesActual && "Este mes se actualiza cada día antes de las 7:00 a. m."}
      </p>
      <Filtros accion="/monitoreo/normas" f={f} sectores={opciones.sectores} tipos={opciones.tipos} />
      {error && <div className="error"><strong>No se pudo leer el reporte.</strong><p>{error}</p></div>}
      {avance && (
        <p className="resumen">
          {filas.length.toLocaleString("es-PE")} normas en el reporte · {avance.relevantes.toLocaleString("es-PE")} relevantes de{" "}
          {avance.total.toLocaleString("es-PE")} publicadas en el mes
          {avance.revisadas < avance.total && ` · faltan revisar ${(avance.total - avance.revisadas).toLocaleString("es-PE")}`}
          {" · "}
          <a href={`/api/monitoreo/csv?vista=normas&${qs}`}>Descargar en Excel</a>
        </p>
      )}
      <div className="lista">
        {filas.map((n) => (
          <Tarjeta
            key={n.analisis_id}
            a={n}
            titulo={[n.tipo, n.numero].filter(Boolean).join(" N° ")}
            subtitulo={n.entidad}
            fecha={n.fecha}
            descripcion={n.sumilla}
            enlaces={[{ texto: "Ver en El Peruano", url: n.url_detalle }]}
          />
        ))}
      </div>
    </>
  );
}
