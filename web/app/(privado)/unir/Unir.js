"use client";

import { useEffect, useState } from "react";
import { seleccionActual, guardarSeleccion, alCambiar } from "../../seleccion";

function comoTexto(r) {
  const partes = [r.titulo, "", r.resumen, ""];
  for (const s of r.secciones || []) {
    partes.push(s.titulo.toUpperCase(), ...s.parrafos, "");
  }
  if ((r.notas || []).length) partes.push("NOTAS PARA LA REVISIÓN", ...r.notas.map((n) => `- ${n}`), "");
  if ((r.fuentes || []).length) {
    partes.push("DOCUMENTOS DE ORIGEN", ...r.fuentes.map((f) => `${f.codigo}: ${f.texto} (${f.lectura})`));
  }
  return partes.join("\n").trim();
}

export default function Unir({ accion }) {
  const [lista, setLista] = useState(null);
  const [estado, setEstado] = useState("listo"); // listo | cargando | hecho | error
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const revisar = () => setLista(seleccionActual());
    revisar();
    return alCambiar(revisar);
  }, []);

  useEffect(() => {
    if (estado !== "cargando") return undefined;
    setSegundos(0);
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [estado]);

  async function generar(rehacer = false) {
    setEstado("cargando");
    setError("");
    try {
      const r = await fetch("/api/ia/unir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, items: lista.map((x) => ({ t: x.t, id: x.id })), rehacer }),
      });
      const datos = await r.json().catch(() => ({
        error:
          r.status === 504
            ? "La IA tardó demasiado (más de 5 minutos). Prueba con menos documentos."
            : `Error del servidor (HTTP ${r.status})`,
      }));
      if (!r.ok || datos.error) throw new Error(datos.error || `Error del servidor (HTTP ${r.status})`);
      setResultado(datos);
      setEstado("hecho");
    } catch (e) {
      setError(e.message);
      setEstado("error");
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(comoTexto(resultado));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  async function descargarWord() {
    const r = await fetch("/api/word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resultado),
    });
    if (!r.ok) {
      setError("No se pudo crear el archivo de Word.");
      return;
    }
    const blob = await r.blob();
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = `${(resultado.titulo || "documento").slice(0, 80)}.docx`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 5000);
  }

  if (lista === null) return null;

  const proyectos = lista.filter((x) => x.t === "P").length;
  const suficiente = accion === "proyecto" ? proyectos >= 2 : lista.length >= 2;

  return (
    <>
      <div className="panel">
        <h2>Documentos seleccionados</h2>
        {lista.length === 0 ? (
          <p>
            No hay documentos seleccionados. Busca en <a href="/">Normas legales</a>, <a href="/buscar">Buscar en todo</a> o{" "}
            <a href="/proyectos">Proyectos de ley</a> y marca la casilla «Seleccionar» de cada uno.
          </p>
        ) : (
          <ol className="seleccionados">
            {lista.map((x) => (
              <li key={`${x.t}${x.id}`}>
                <span className="etq gris">{x.t === "N" ? "Norma" : "Proyecto"}</span> {x.e || x.id}{" "}
                {estado !== "cargando" && (
                  <button
                    type="button"
                    className="quitar"
                    onClick={() => guardarSeleccion(lista.filter((y) => !(y.t === x.t && y.id === x.id)))}
                    aria-label="Quitar"
                  >
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        {accion === "proyecto" && lista.length > proyectos && (
          <p className="ia-pendiente">Las normas seleccionadas se usarán solo como contexto.</p>
        )}
        {!suficiente && lista.length > 0 && (
          <p className="ia-aviso">
            {accion === "proyecto" ? "Selecciona al menos 2 proyectos de ley." : "Selecciona al menos 2 documentos."}
          </p>
        )}
        {suficiente && estado !== "hecho" && (
          <div className="acciones">
            <button className="boton" type="button" disabled={estado === "cargando"} onClick={() => generar(false)}>
              {estado === "cargando"
                ? `La IA está leyendo y redactando… ${segundos} s`
                : accion === "proyecto"
                ? "✦ Redactar proyecto unificado"
                : "✦ Unir con IA"}
            </button>
          </div>
        )}
        {estado === "cargando" && (
          <p className="ia-pendiente">
            Descarga el texto completo de cada documento y lo analiza. Suele tardar entre 30 segundos y 3 minutos. No cierres la página.
          </p>
        )}
        {estado === "error" && <p className="ia-aviso">{error}</p>}
      </div>

      {estado === "hecho" && resultado && (
        <section className="ia documento">
          <h2 className="doc-titulo">{resultado.titulo}</h2>
          {resultado.resumen && <p className="ia-panorama">{resultado.resumen}</p>}
          {resultado.secciones.map((s, i) => (
            <div key={i}>
              {s.titulo && <h3>{s.titulo}</h3>}
              {s.parrafos.map((p, j) => (
                <p key={j}>{p}</p>
              ))}
            </div>
          ))}
          {resultado.notas.length > 0 && (
            <>
              <h3>Notas para la revisión</h3>
              <ul className="ia-puntos">
                {resultado.notas.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          )}
          <h3>Documentos de origen</h3>
          <ul className="ia-puntos">
            {resultado.fuentes.map((f) => (
              <li key={f.codigo}>
                <strong>{f.codigo}:</strong>{" "}
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer">{f.texto}</a>
                ) : (
                  f.texto
                )}{" "}
                <span className="etq gris">{f.lectura}</span>
                {f.aviso && <span className="ia-pendiente"> {f.aviso}</span>}
              </li>
            ))}
          </ul>
          <p className="ia-nota">
            Borrador elaborado con inteligencia artificial. Debe ser revisado por un abogado antes de usarse.
          </p>
          <div className="acciones">
            <button className="boton" type="button" onClick={descargarWord}>Descargar en Word</button>
            <button className="boton sec" type="button" onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar texto"}</button>
            <button className="boton sec" type="button" onClick={() => generar(true)}>Volver a generar</button>
          </div>
        </section>
      )}
    </>
  );
}
