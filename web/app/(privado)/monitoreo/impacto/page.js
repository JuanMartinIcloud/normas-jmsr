import AvisoMes from "../AvisoMes";
import { exigirUsuario } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { leerFiltrosMonitoreo, normasAnalizadas, proyectosAnalizados, opcionesFiltros, COMITES } from "../../../../lib/monitoreo";
import { leerPeriodo } from "../../../../lib/periodo";
import { urlProyecto } from "../../../../lib/resumenes";
import Filtros from "../Filtros";
import Tarjeta from "../Tarjeta";
import { enlacesLey, estadoProyecto, recorrido } from "../../../../lib/leyes";

export const metadata = { title: "Impacto · Monitoreo empresarial" };

const ORDEN_IMP = { Alto: 0, Moderado: 1, Bajo: 2 };
const ORDEN_CAL = { Desfavorable: 0, "Para seguimiento": 1, Favorable: 2 };

export default async function Impacto({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const f = leerFiltrosMonitoreo(searchParams || {});
  const per = leerPeriodo(searchParams || {});
  let normas = [];
  let proyectos = [];
  let opciones = { sectores: [], tipos: [] };
  let error = "";
  try {
    [normas, proyectos, opciones] = await Promise.all([
      normasAnalizadas(f, per.desde, per.hasta),
      proyectosAnalizados(f, per.desde, per.hasta),
      opcionesFiltros(per.desde, per.hasta),
    ]);
  } catch (e) {
    error = mensajeError(e);
  }
  const todos = [
    ...normas.map((n) => ({ ...n, origen: "Norma legal" })),
    ...proyectos.map((p) => ({ ...p, origen: "Proyecto de ley" })),
  ].sort(
    (a, b) => (b.puntaje || 0) - (a.puntaje || 0) || (ORDEN_IMP[a.impacto] ?? 3) - (ORDEN_IMP[b.impacto] ?? 3) ||
      (ORDEN_CAL[a.calificacion] ?? 3) - (ORDEN_CAL[b.calificacion] ?? 3)
  );
  const imp = (x) => `${x.impacto || ""}${x.puntaje ? ` (${x.puntaje}/10)` : ""}`;
  const nombre = (x) => (x.origen === "Norma legal" ? [x.tipo, x.numero].filter(Boolean).join(" N° ") : `Proposición ${x.numero}`);

  // Acciones agrupadas por comite
  const porComite = new Map(COMITES.map((c) => [c, []]));
  const directorio = [];
  for (const x of todos) {
    for (const a of x.acciones || []) porComite.get(a.comite)?.push({ doc: nombre(x), accion: a.accion, cal: x.calificacion, imp: imp(x) });
    if (x.accion_directorio && !/^ninguna/i.test(x.accion_directorio)) directorio.push({ doc: nombre(x), accion: x.accion_directorio, cal: x.calificacion, imp: imp(x) });
  }
  const qs = new URLSearchParams(Object.entries(searchParams || {}).filter(([, v]) => typeof v === "string" && v)).toString();

  return (
    <>
      <h1>Impacto en el sector empresarial · {per.nombre}</h1>
      <AvisoMes mes={per.desde.slice(0, 7)} />
      <p className="sub">
        Normas legales y proyectos de ley juntos, ordenados por puntaje de impacto (de 10 a 1). Abajo, las acciones sugeridas a cada
        comité y al Directorio de AmCham.
      </p>
      <Filtros accion="/monitoreo/impacto" f={f} sectores={opciones.sectores} />
      {error && <div className="error"><strong>No se pudo leer el reporte.</strong><p>{error}</p></div>}
      <p className="resumen">
        {normas.length} normas · {proyectos.length} proyectos de ley ·{" "}
        <a href={`/api/monitoreo/csv?vista=impacto&${qs}`}>Descargar en Excel</a>
      </p>

      <h2 className="seccion">Acciones del Directorio de AmCham</h2>
      {directorio.length === 0 ? (
        <p className="vacio">No hay acciones sugeridas al Directorio en este periodo.</p>
      ) : (
        <div className="envoltura-tabla">
          <table className="tabla-mon">
            <thead><tr><th>Documento</th><th>Calificación</th><th>Impacto</th><th>Acción sugerida</th></tr></thead>
            <tbody>
              {directorio.map((d, i) => (
                <tr key={i}><td>{d.doc}</td><td>{d.cal}</td><td>{d.imp}</td><td>{d.accion}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="seccion">Acciones por comité</h2>
      {[...porComite.entries()].filter(([, l]) => l.length).map(([c, l]) => (
        <details key={c} className="otros" open={l.length <= 5}>
          <summary><strong>Comité {c}</strong> · {l.length} {l.length === 1 ? "acción" : "acciones"}</summary>
          <div className="envoltura-tabla">
            <table className="tabla-mon">
              <thead><tr><th>Documento</th><th>Calificación</th><th>Impacto</th><th>Acción</th></tr></thead>
              <tbody>
                {l.map((d, i) => (
                  <tr key={i}><td>{d.doc}</td><td>{d.cal}</td><td>{d.imp}</td><td>{d.accion}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      <h2 className="seccion" id="detalle">Detalle por documento ({todos.length})</h2>
      <div className="lista">
        {todos.map((x) => (
          <Tarjeta
            key={`${x.origen}-${x.analisis_id}`}
            a={x}
            titulo={`${x.origen}: ${nombre(x)}`}
            subtitulo={x.origen === "Norma legal" ? x.entidad : x.proponente}
            fecha={x.origen === "Norma legal" ? x.fecha : x.fecha_presentacion}
            descripcion={x.origen === "Norma legal" ? x.sumilla : x.titulo}
            movimiento={x.origen === "Norma legal" ? "" : [`Estado: ${estadoProyecto(x) || "—"}`, recorrido(x)].filter(Boolean).join(" · ")}
            enlaces={x.origen === "Norma legal"
              ? [{ texto: "Ver en El Peruano", url: x.url_detalle }]
              : [{ texto: "Expediente", url: urlProyecto(x) }, ...enlacesLey(x)]}
          />
        ))}
      </div>
    </>
  );
}
