"use client";

import { useState } from "react";

// «Otra área»: la IA revisa si ya existe una equivalente; si no, la agrega a la lista para todos.
export default function OtraArea() {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("");
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");

  async function enviar(e) {
    e.preventDefault();
    setEstado("enviando");
    setError("");
    setResultado(null);
    const r = await fetch("/api/areas/proponer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    const d = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
    setEstado("");
    if (!r.ok || d.error) {
      setError(d.error || "No se pudo agregar el área.");
      return;
    }
    setResultado(d);
    setTexto("");
  }

  return (
    <div className="otra-area">
      <form className="filtros" onSubmit={enviar}>
        <label className="ancho">
          ¿No está el área que buscas? Escríbela con tus palabras
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Por ejemplo: minería ilegal, energías renovables, comercio electrónico"
            maxLength={120}
          />
        </label>
        <button className="boton" type="submit" disabled={estado === "enviando" || texto.trim().length < 3}>
          {estado === "enviando" ? "Revisando…" : "Agregar área"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {resultado?.existente && (
        <p className="ia-pendiente">
          Esa área ya existe como <strong>{resultado.existente.nombre}</strong>.{" "}
          <a href={`/areas/${resultado.existente.id}`}>Ver su reporte →</a>
        </p>
      )}
      {resultado?.nueva && (
        <p className="ia-pendiente">
          Se agregó el área <strong>{resultado.nueva.nombre}</strong>: {resultado.nueva.descripcion}{" "}
          Desde esta noche entra a la revisión diaria. <a href={`/areas/${resultado.nueva.id}`}>Abrir su reporte y revisar el mes →</a>
        </p>
      )}
    </div>
  );
}
