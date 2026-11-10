import { exigirUsuario } from "../../../lib/auth";
import { mensajeError } from "../../../lib/errores";
import { contarCambios, historialDescargas, ultimaDescarga } from "../../../lib/excel";

export const metadata = { title: "Descargar en Excel" };
export const dynamic = "force-dynamic";

const n = (x) => Number(x || 0).toLocaleString("es-PE");

export default async function Excel() {
  const u = await exigirUsuario();
  let ultima = null;
  let cambios = null;
  let historial = [];
  let error = "";
  try {
    ultima = await ultimaDescarga(u.id);
    if (ultima) cambios = await contarCambios(ultima.hasta);
    historial = await historialDescargas(u.id);
  } catch (e) {
    error = mensajeError(e);
  }
  return (
    <main className="contenedor">
      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/">Normas legales</a>
        <a className="atajo" href="/proyectos">Proyectos de ley</a>
        <a className="atajo" href="/resumenes">Resúmenes diarios</a>
        <a className="atajo" href="/areas">Monitoreo por áreas</a>
        <a className="atajo activo" href="/excel">Descargar en Excel</a>
      </nav>
      <h1>Descargar en Excel</h1>
      <p className="sub">
        Un Excel con tres hojas: normas legales, proyectos de ley y el seguimiento de cada proyecto (fecha, cámara,
        estado y comisión). El texto completo de cada documento no entra en Excel; cada fila trae el enlace para abrirlo.
      </p>
      {error && <div className="error"><strong>No se pudo leer tus descargas.</strong><p>{error}</p></div>}

      {!ultima ? (
        <div className="panel">
          <h2>Primera descarga: todo</h2>
          <p>
            Todavía no has descargado el Excel. La primera vez trae todo lo guardado (unas 250.000 normas y 16.000
            proyectos). Puede tardar hasta 3 minutos en empezar a bajar por completo; no cierres la página mientras baja.
          </p>
          <a className="boton" href="/api/excel?tipo=cambios">Descargar todo</a>
        </div>
      ) : (
        <div className="panel">
          <h2>Solo los cambios</h2>
          <p>
            Tu última descarga fue el {ultima.hasta_txt}. Desde entonces hay {n(cambios?.normas)} normas,{" "}
            {n(cambios?.proyectos)} proyectos y {n(cambios?.seguimientos)} pasos de seguimiento nuevos o modificados.
            La columna «Cambio» de cada fila dice si es <strong>Nuevo</strong> o <strong>Modificado</strong>.
          </p>
          <a className="boton" href="/api/excel?tipo=cambios">Descargar solo los cambios</a>{" "}
          <a className="boton sec" href="/api/excel?tipo=todo">Descargar todo de nuevo</a>
        </div>
      )}

      {historial.length > 0 && (
        <div className="panel">
          <h2>Tus descargas</h2>
          <ul>
            {historial.map((h, i) => (
              <li key={i}>
                {h.cuando} — {h.completa ? "todo" : "solo cambios"}: {n(h.normas)} normas, {n(h.proyectos)} proyectos,{" "}
                {n(h.seguimientos)} pasos de seguimiento
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
