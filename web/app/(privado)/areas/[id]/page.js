import { notFound } from "next/navigation";
import { exigirUsuario } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { areaPorId, leerFiltrosArea } from "../../../../lib/areas";
import { nombreMes } from "../../../../lib/monitoreo";
import ReporteArea from "../ReporteArea";

export const metadata = { title: "Reporte del área" };

export default async function PaginaArea({ params, searchParams }) {
  await exigirUsuario();
  const { id } = await params;
  const f = leerFiltrosArea((await searchParams) || {});
  let area = null;
  let error = "";
  try {
    area = await areaPorId(id);
  } catch (e) {
    error = mensajeError(e);
  }
  if (!area && !error) notFound();
  return (
    <main className="contenedor">
      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/areas">← Todas las áreas</a>
      </nav>
      {error ? (
        <div className="error"><strong>No se pudo leer el reporte.</strong><p>{error}</p></div>
      ) : (
        <>
          <h1>{area.nombre} · {nombreMes(f.mes)}</h1>
          <p className="sub">{area.descripcion}</p>
          <ReporteArea area={area} f={f} />
        </>
      )}
    </main>
  );
}
