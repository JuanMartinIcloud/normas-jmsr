"use client";

import { useState } from "react";

// Pide a la IA el resumen ejecutivo del periodo (se guarda: la segunda vez sale al instante)
export default function BotonEjecutivo({ desde, hasta, nombre, cantidad }) {
  const [estado, setEstado] = useState("listo");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");

  async function generar(rehacer = false) {
    setEstado("cargando");
    setError("");
    try {
      const r = await fetch("/api/monitoreo/ejecutivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desde, hasta, rehacer }),
      });
      const d = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
      if (!r.ok || d.error) throw new Error(d.error || `Error del servidor (HTTP ${r.status})`);
      setDatos(d);
      setEstado("listo");
    } catch (e) {
      setError(e.message);
      setEstado("error");
    }
  }

  if (!cantidad) return null;
  return (
    <div className="resumen-ia">
      {!datos && (
        <button className="boton" type="button" onClick={() => generar(false)} disabled={estado === "cargando"}>
          {estado === "cargando" ? "La IA está redactando el resumen ejecutivo…" : `✦ Redactar el resumen ejecutivo de ${nombre} con IA`}
        </button>
      )}
      {error && <p className="ia-aviso">{error}</p>}
      {datos && (
        <div className="grafico">
          <h3>Resumen ejecutivo · {nombre}</h3>
          <p>{datos.panorama}</p>
          {datos.puntos?.length > 0 && (
            <>
              <h4>Puntos clave</h4>
              <ul>{datos.puntos.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          {datos.riesgos?.length > 0 && (
            <>
              <h4>Riesgos para el clima de inversión</h4>
              <ul>{datos.riesgos.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          {datos.oportunidades?.length > 0 && (
            <>
              <h4>Oportunidades</h4>
              <ul>{datos.oportunidades.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          {datos.recomendaciones?.length > 0 && (
            <>
              <h4>Recomendaciones al Directorio</h4>
              <ul>{datos.recomendaciones.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          <p className="ia-pendiente">
            Basado en {datos.cantidad} documentos analizados. Redactado por IA: revísalo antes de difundirlo.{" "}
            <button type="button" className="enlace-btn" onClick={() => generar(true)}>Volver a redactar</button>
          </p>
        </div>
      )}
    </div>
  );
}
