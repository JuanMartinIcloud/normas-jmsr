"use client";

import { useState } from "react";

export default function BotonAnalizarMes({ mes }) {
  const [estado, setEstado] = useState("");
  const [mensaje, setMensaje] = useState("");

  async function pedir() {
    setEstado("enviando");
    const r = await fetch("/api/monitoreo/pedir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "mes", mes }),
    });
    const d = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
    if (!r.ok || d.error) {
      setEstado("");
      setMensaje(d.error || "No se pudo pedir el análisis.");
      return;
    }
    setEstado("listo");
    setMensaje(
      d.alMomento
        ? "Listo: la IA empezó a revisar el mes. Un mes completo toma entre 30 minutos y unas horas; las cifras se completan solas."
        : "Pedido anotado: la IA revisará el mes en la próxima ejecución automática (esta madrugada)."
    );
  }

  if (estado === "listo") return <strong>{mensaje}</strong>;
  return (
    <>
      <button className="boton chico" type="button" onClick={pedir} disabled={estado === "enviando"}>
        {estado === "enviando" ? "Un momento…" : "Revisar este mes con IA"}
      </button>
      {mensaje && <span className="ia-aviso"> {mensaje}</span>}
    </>
  );
}
