"use client";

import { useState } from "react";

// Correos que reciben el informe: una lista general (Directorio) y una por comité
export default function Destinatarios({ general, comites, lista }) {
  const [estado, setEstado] = useState("");

  async function guardar(e) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const porComite = {};
    for (const c of lista) porComite[c] = String(d.get(`c_${c}`) || "");
    setEstado("Guardando…");
    const r = await fetch("/api/monitoreo/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "destinatarios", general: String(d.get("general") || ""), comites: porComite }),
    });
    const res = await r.json().catch(() => ({}));
    setEstado(r.ok ? "Guardado." : res.error || "No se pudo guardar.");
  }

  return (
    <details className="otros">
      <summary><strong>Destinatarios del correo</strong> (solo el administrador)</summary>
      <form className="filtros" onSubmit={guardar}>
        <label className="ancho">
          Informe completo (por ejemplo, Directorio). Separa los correos con comas.
          <textarea name="general" rows={2} defaultValue={general.join(", ")} />
        </label>
        {lista.map((c) => (
          <label key={c}>
            Comité {c}
            <input name={`c_${c}`} defaultValue={(comites[c] || []).join(", ")} placeholder="correo@empresa.com" />
          </label>
        ))}
        <div className="acciones">
          <button className="boton" type="submit">Guardar destinatarios</button>
          {estado && <span className="ia-pendiente">{estado}</span>}
        </div>
      </form>
    </details>
  );
}
