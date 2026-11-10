import { exigirUsuario } from "../../../../../lib/auth";
import { notFound } from "next/navigation";
import { consultar } from "../../../../../lib/db";
import { asegurarTablas, FRECUENCIAS, urlBuscador } from "../../../../../lib/busquedas";
import AccionesBusqueda from "../AccionesBusqueda";
import BotonImpacto from "../BotonImpacto";
import { estadoImpacto } from "../../../../../lib/pedidos";

export const metadata = { title: "Resultados · Búsquedas guardadas" };

export default async function Resultados({ params: parametrosRuta }) {
  const params = await parametrosRuta;
  await exigirUsuario();
  const id = Number(params.id);
  if (!id) notFound();
  await asegurarTablas();
  const [b] = await consultar(`SELECT * FROM busquedas_guardadas WHERE id = $1`, [id]);
  if (!b) notFound();
  const ejecuciones = await consultar(
    `SELECT id, desde::text, hasta::text, total_normas, total_proyectos, normas, proyectos, resumen, enviado, creado_en::text
     FROM busqueda_ejecuciones WHERE busqueda_id = $1 ORDER BY hasta DESC, creado_en DESC LIMIT 60`,
    [id]
  );
  // Estado de cada documento en el filtro empresarial (las ejecuciones antiguas no guardaban el documento)
  const ids = (tipo) => ejecuciones.flatMap((e) => (tipo === "N" ? e.normas : e.proyectos) || []).map((x) => x.id).filter(Boolean);
  let estados = {};
  try {
    estados = await estadoImpacto(ids("N"), ids("P"));
  } catch (err) {
    console.error(err);
  }
  return (
    <>
      <p className="ia-pendiente"><a href="/monitoreo/busquedas">← Búsquedas guardadas</a></p>
      <h1>{b.nombre}</h1>
      <p className="sub">
        {b.pregunta ? `Pregunta: «${b.pregunta}»` : `Palabras: «${b.q}»`} · {FRECUENCIAS[b.frecuencia]} · {b.activa ? "Activa" : "Pausada"}
        {b.terminos?.length > 0 && <><br />Términos: {b.terminos.join(", ")}</>}
        {b.refinar?.length > 0 && <><br />Filtros: {b.refinar.join(", ")}</>}
      </p>
      <div className="etiquetas">
        <a className="boton sec chico" href={urlBuscador(b)}>Abrir en el buscador</a>
        <AccionesBusqueda b={{ id: b.id, nombre: b.nombre, frecuencia: b.frecuencia, activa: b.activa, destinatarios: b.destinatarios || [], con_resumen: b.con_resumen }} />
      </div>
      <h2 className="seccion">Resultados ({ejecuciones.length})</h2>
      {ejecuciones.length === 0 && <p className="vacio">Aún no se ha ejecutado. Pulsa «Ejecutar ahora» o espera a su próxima ejecución.</p>}
      {ejecuciones.map((e, i) => (
        <details key={e.id} className="grafico otros" open={i === 0}>
          <summary>
            <strong>Del {e.desde} al {e.hasta}</strong> · {e.total_normas} normas · {e.total_proyectos} proyectos
            {e.enviado && " · enviado por correo"}
          </summary>
          {e.resumen?.panorama && (
            <>
              <h4>Resumen</h4>
              <p>{e.resumen.panorama}</p>
              <ul>{(e.resumen.puntos || []).map((p, k) => <li key={k}>{p}</li>)}</ul>
            </>
          )}
          {e.resumen?.error && <p className="ia-aviso">No se pudo generar el resumen: {e.resumen.error}</p>}
          <DosResultados e={e} estados={estados} />
          <p><a href={urlBuscador(b, e.desde, e.hasta)}>Ver todos los resultados de este periodo en el buscador →</a></p>
        </details>
      ))}
    </>
  );
}

// Dos resultados: lo que tiene impacto empresarial y todo lo encontrado (sin filtro), con el boton para
// pasar un documento de un lado al otro
function DosResultados({ e, estados }) {
  const normas = (e.normas || []).map((n) => ({ ...n, tipo: "N", texto: n.sumilla, detalle: n.fecha }));
  const proyectos = (e.proyectos || []).map((p) => ({ ...p, tipo: "P", texto: p.titulo, detalle: `${p.fecha}, ${p.estado}` }));
  const conId = [...normas, ...proyectos].some((x) => x.id);
  const estadoDe = (x) => (x.id ? estados[`${x.tipo}${x.id}`] || "sin_revisar" : null);
  const empresarial = [...normas, ...proyectos].filter((x) => estadoDe(x) === "impacto");
  const item = (x, k) => (
    <li key={`${x.tipo}${x.id || k}`}>
      {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer">{x.nombre}</a> : x.nombre} ({x.detalle}) — {x.texto}
      {x.id && <> <BotonImpacto tipo={x.tipo} id={String(x.id)} estado={estadoDe(x)} /></>}
    </li>
  );
  return (
    <>
      {conId ? (
        <>
          <h4>Con impacto empresarial ({empresarial.length})</h4>
          {empresarial.length ? <ul>{empresarial.map(item)}</ul> : <p className="vacio">Ninguno por ahora.</p>}
        </>
      ) : (
        <p className="ia-pendiente">Este resultado es anterior a la separación por impacto empresarial: pulsa «Ejecutar ahora» para verlo separado.</p>
      )}
      <h4>Todos los resultados, sin filtro</h4>
      <h4>Normas legales ({e.total_normas}{e.total_normas > normas.length ? `, se muestran las ${normas.length} más relevantes` : ""})</h4>
      <ul>{normas.map(item)}</ul>
      <h4>Proyectos de ley ({e.total_proyectos}{e.total_proyectos > proyectos.length ? `, se muestran los ${proyectos.length} más relevantes` : ""})</h4>
      <ul>{proyectos.map(item)}</ul>
    </>
  );
}
