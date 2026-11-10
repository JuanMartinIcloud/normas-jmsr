"use client";

import { useState } from "react";

function Refs({ refs, referencias }) {
  const lista = (refs || []).map((r) => ({ c: r, ...(referencias[r] || {}) })).filter((r) => r.texto);
  if (!lista.length) return null;
  return (
    <span className="ia-refs">
      {lista.map((r) =>
        r.url ? (
          <a key={r.c} className="ia-ref" href={r.url} target="_blank" rel="noopener noreferrer">{r.texto}</a>
        ) : (
          <span key={r.c} className="ia-ref">{r.texto}</span>
        )
      )}
    </span>
  );
}

function Grupo({ titulo, grupo, totales, referencias }) {
  if (!grupo || (!grupo.panorama && !(grupo.puntos || []).length)) return null;
  return (
    <>
      <h3>{titulo}</h3>
      {totales && totales.total > totales.incluidas && (
        <p className="ia-aviso">
          Se resumieron los {totales.incluidas} más recientes de {totales.total.toLocaleString("es-PE")} resultados.
          Para abarcar otros, ajusta los filtros (por ejemplo, las fechas).
        </p>
      )}
      {grupo.panorama && <p className="ia-panorama">{grupo.panorama}</p>}
      <ul className="ia-puntos">
        {(grupo.puntos || []).map((p, i) => (
          <li key={i}>
            {p.texto} <Refs refs={p.refs} referencias={referencias} />
          </li>
        ))}
      </ul>
    </>
  );
}

function comoTexto(r) {
  const partes = [];
  for (const [nombre, g] of [["NORMAS LEGALES", r.normas], ["PROYECTOS DE LEY", r.proyectos]]) {
    if (!g || (!g.panorama && !(g.puntos || []).length)) continue;
    partes.push(nombre, g.panorama || "");
    for (const p of g.puntos || []) {
      const docs = (p.refs || []).map((c) => (r.referencias[c] || {}).texto).filter(Boolean);
      partes.push(`- ${p.texto}${docs.length ? ` (${docs.join("; ")})` : ""}`);
    }
    partes.push("");
  }
  return partes.join("\n").trim();
}

// Boton "Resumir con IA" para lo que muestran los filtros actuales
export default function BotonResumir({ ambito = "ambos", filtros = {}, cantidad = 0 }) {
  const [estado, setEstado] = useState("listo"); // listo | cargando | hecho | error
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");
  const [copiado, setCopiado] = useState(false);

  async function resumir() {
    setEstado("cargando");
    setError("");
    try {
      const r = await fetch("/api/ia/resumir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ambito, filtros }),
      });
      const datos = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
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

  if (!cantidad) return null;

  return (
    <div className="ia-boton">
      {estado !== "hecho" && (
        <button className="boton" type="button" onClick={resumir} disabled={estado === "cargando"}>
          {estado === "cargando" ? "La IA está leyendo los resultados…" : "✦ Resumir con IA"}
        </button>
      )}
      {estado === "cargando" && (
        <p className="ia-pendiente">Puede tardar hasta un minuto. No cierres la página.</p>
      )}
      {estado === "error" && <p className="ia-aviso">{error}</p>}
      {estado === "hecho" && resultado && (
        <section className="ia">
          <div className="ia-cabecera">
            <span className="ia-titulo">Resumen con IA de esta búsqueda</span>
            <button className="boton sec" type="button" onClick={() => setEstado("listo")}>Cerrar</button>
          </div>
          <Grupo titulo="Normas legales" grupo={resultado.normas} totales={resultado.totales?.normas} referencias={resultado.referencias} />
          <Grupo titulo="Proyectos de ley" grupo={resultado.proyectos} totales={resultado.totales?.proyectos} referencias={resultado.referencias} />
          <p className="ia-nota">
            Elaborado con inteligencia artificial a partir de las sumillas y títulos oficiales. Revisa el texto de cada documento antes de usarlo.
          </p>
          <div className="acciones">
            <button className="boton sec" type="button" onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar texto"}</button>
          </div>
        </section>
      )}
    </div>
  );
}
