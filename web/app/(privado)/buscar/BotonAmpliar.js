"use client";

import { useState } from "react";

// Pide a la IA expresiones parecidas y vuelve a buscar incluyendolas
export default function BotonAmpliar({ q, desde, hasta }) {
  const [estado, setEstado] = useState("listo");
  const [error, setError] = useState("");

  async function ampliar() {
    setEstado("cargando");
    setError("");
    try {
      const r = await fetch("/api/ia/ampliar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const d = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
      if (!r.ok || d.error) throw new Error(d.error || `Error del servidor (HTTP ${r.status})`);
      const p = new URLSearchParams();
      p.set("q", q);
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      p.set("t", d.terminos.join("|"));
      p.set("orden", "r"); // lo mas relacionado primero
      window.location.href = `/buscar?${p.toString()}`;
    } catch (e) {
      setError(e.message);
      setEstado("error");
    }
  }

  return (
    <div className="ia-boton">
      <button className="boton sec" type="button" onClick={ampliar} disabled={estado === "cargando"}>
        {estado === "cargando" ? "La IA está buscando expresiones parecidas…" : "✦ Ampliar la búsqueda con IA"}
      </button>
      <p className="ia-pendiente">
        Agrega sinónimos jurídicos y leyes relacionadas (por ejemplo, la ley principal del tema) para encontrar documentos que usan otras palabras.
      </p>
      {estado === "error" && <p className="ia-aviso">{error}</p>}
    </div>
  );
}
