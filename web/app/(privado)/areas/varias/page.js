import { exigirUsuario } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { areaPorId, leerFiltrosArea } from "../../../../lib/areas";
import { nombreMes } from "../../../../lib/monitoreo";
import ReporteArea from "../ReporteArea";

export const metadata = { title: "Reportes de varias áreas" };

// Un reporte por cada area marcada, uno debajo del otro
export default async function VariasAreas({ searchParams }) {
  await exigirUsuario();
  const sp = (await searchParams) || {};
  const f = leerFiltrosArea(sp);
  const ids = String(sp.ids || "").split(",").filter((x) => /^\d{1,9}$/.test(x)).slice(0, 30);
  let areas = [];
  let error = "";
  try {
    areas = (await Promise.all(ids.map((i) => areaPorId(i)))).filter(Boolean);
  } catch (e) {
    error = mensajeError(e);
  }
  return (
    <main className="contenedor">
      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/areas">← Todas las áreas</a>
      </nav>
      <h1>Reportes por área · {nombreMes(f.mes)}</h1>
      <form className="filtros" method="get">
        <input type="hidden" name="ids" value={ids.join(",")} />
        <label>
          Mes
          <input type="month" name="mes" defaultValue={f.mes} min="2015-01" />
        </label>
        <button className="boton" type="submit">Ver</button>
      </form>
      {error && <div className="error"><strong>No se pudieron leer los reportes.</strong><p>{error}</p></div>}
      {!areas.length && !error && <p className="resumen">No marcaste ningún área. <a href="/areas">Volver a la lista</a></p>}
      <nav className="atajos" aria-label="Áreas del reporte">
        {areas.map((a) => (
          <a key={a.id} className="atajo" href={`#area-${a.id}`}>{a.nombre}</a>
        ))}
      </nav>
      {areas.map((a) => (
        <div key={a.id} id={`area-${a.id}`} className="bloque-area">
          <h2>{a.nombre}</h2>
          <ReporteArea area={a} f={f} conFiltros={false} />
        </div>
      ))}
    </main>
  );
}
