import { exigirUsuario } from "../../../../lib/auth";
import { mensajeError } from "../../../../lib/errores";
import { consultar } from "../../../../lib/db";
import { asegurarTablas, FRECUENCIAS, urlBuscador } from "../../../../lib/busquedas";
import AccionesBusqueda from "./AccionesBusqueda";
import NuevaBusqueda from "./NuevaBusqueda";

export const metadata = { title: "Búsquedas guardadas · Monitoreo empresarial" };

export default async function Busquedas() {
  await exigirUsuario();
  let lista = [];
  let error = "";
  try {
    await asegurarTablas();
    lista = await consultar(
      `SELECT b.*, b.ultima_ejecucion::text AS ultima,
              (SELECT row_to_json(e) FROM (SELECT desde::text, hasta::text, total_normas, total_proyectos FROM busqueda_ejecuciones
                WHERE busqueda_id = b.id ORDER BY creado_en DESC LIMIT 1) e) AS ultimo
       FROM busquedas_guardadas b ORDER BY b.activa DESC, b.nombre`
    );
  } catch (e) {
    error = mensajeError(e);
  }
  return (
    <>
      <h1>Búsquedas guardadas</h1>
      <p className="sub">
        Cada búsqueda se ejecuta sola con su frecuencia, antes de las 7:00 a. m., y guarda su resultado con un resumen de IA.
        Si tiene destinatarios, también se envía por correo.
      </p>
      {error && <div className="error"><strong>No se pudo leer.</strong><p>{error}</p></div>}
      {lista.length === 0 ? (
        <p className="vacio">Todavía no hay búsquedas guardadas. Crea una abajo, o usa «★ Guardar esta búsqueda» en el buscador.</p>
      ) : (
        <div className="lista">
          {lista.map((b) => (
            <article key={b.id} className={`norma ${b.activa ? "" : "tarjeta-mon quitado"}`}>
              <div className="linea1">
                <span className="titulo"><a href={`/monitoreo/busquedas/${b.id}`}>{b.nombre}</a></span>
                <span className="entidad">{FRECUENCIAS[b.frecuencia]}</span>
                <span className="fecha">{b.activa ? "Activa" : "Pausada"}</span>
              </div>
              <p className="sumilla">
                {b.pregunta ? `Pregunta: «${b.pregunta}»` : `Palabras: «${b.q}»`}
                {b.terminos?.length > 0 && ` · Términos: ${b.terminos.join(", ")}`}
                {b.refinar?.length > 0 && ` · Filtros: ${b.refinar.join(", ")}`}
              </p>
              <p className="movimiento">
                {b.ultimo
                  ? `Último resultado: del ${b.ultimo.desde} al ${b.ultimo.hasta} · ${b.ultimo.total_normas} normas, ${b.ultimo.total_proyectos} proyectos`
                  : "Aún no se ha ejecutado."}
                {b.destinatarios?.length > 0 && ` · Se envía a: ${b.destinatarios.join(", ")}`}
                {b.creado_por && ` · Creada por ${b.creado_por}`}
              </p>
              <div className="etiquetas">
                <a className="boton sec chico" href={`/monitoreo/busquedas/${b.id}`}>Ver resultados</a>
                <a className="boton sec chico" href={urlBuscador(b)}>Abrir en el buscador</a>
                <AccionesBusqueda b={{ id: b.id, nombre: b.nombre, frecuencia: b.frecuencia, activa: b.activa, destinatarios: b.destinatarios || [], con_resumen: b.con_resumen }} />
              </div>
            </article>
          ))}
        </div>
      )}
      <h2 className="seccion">Nueva búsqueda guardada</h2>
      <NuevaBusqueda />
    </>
  );
}
