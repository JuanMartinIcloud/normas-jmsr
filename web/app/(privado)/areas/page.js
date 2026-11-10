import { exigirUsuario } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { listarAreas } from "../../../lib/areas";
import { hoyLima } from "../../../lib/monitoreo";
import ListaAreas from "./ListaAreas";
import OtraArea from "./OtraArea";

export const metadata = { title: "Monitoreo por áreas" };

export default async function Areas() {
  await exigirUsuario();
  let areas = [];
  let error = "";
  try {
    areas = await listarAreas();
  } catch (e) {
    error = mensajeError(e);
  }
  const mes = hoyLima().slice(0, 7);
  return (
    <main className="contenedor">
      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/">Normas legales</a>
        <a className="atajo" href="/proyectos">Proyectos de ley</a>
        <a className="atajo" href="/resumenes">Resúmenes diarios</a>
        <a className="atajo activo" href="/areas">Monitoreo por áreas</a>
      </nav>
      <h1>Monitoreo por áreas</h1>
      <p className="sub">
        Elige un área para ver las normas legales y los proyectos de ley que la afectan, calificados por la IA como
        favorables, desfavorables o para seguimiento, con su puntaje de impacto. Puedes marcar varias áreas para ver un
        reporte de cada una.
      </p>
      {error && <div className="error"><strong>No se pudo leer la lista de áreas.</strong><p>{error}</p></div>}
      <ListaAreas areas={areas} mes={mes} />
      <OtraArea />
    </main>
  );
}
