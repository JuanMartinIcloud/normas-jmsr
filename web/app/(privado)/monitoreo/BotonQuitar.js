"use client";

import { useState } from "react";

// Quita un item del reporte (o lo devuelve). Queda registrado quien lo hizo.
export default function BotonQuitar({ id, excluido }) {
  const [estado, setEstado] = useState(excluido ? "quitado" : "visible");
  async function cambiar() {
    const excluir = estado !== "quitado";
    setEstado("guardando");
    const r = await fetch("/api/monitoreo/excluir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, excluir }),
    });
    setEstado(r.ok ? (excluir ? "quitado" : "visible") : excluir ? "visible" : "quitado");
  }
  if (estado === "guardando") return <span className="etq gris">Guardando…</span>;
  return estado === "quitado" ? (
    <button type="button" className="boton sec chico" onClick={cambiar} title="Volver a incluir en el reporte">
      Quitado · Devolver al reporte
    </button>
  ) : (
    <button type="button" className="boton sec chico" onClick={cambiar} title="Quitar este ítem del reporte">
      ✕ Quitar del reporte
    </button>
  );
}
