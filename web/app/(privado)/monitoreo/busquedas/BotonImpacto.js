"use client";

import { useState } from "react";

// Estado de un documento en el filtro empresarial y boton para pasarlo o quitarlo
const ETIQUETA = {
  impacto: "Con impacto empresarial",
  sin_impacto: "Sin impacto empresarial (según la IA)",
  quitado: "Quitado del impacto empresarial",
  pendiente: "La IA lo está analizando",
  sin_revisar: "La IA lo revisará en breve",
};

export default function BotonImpacto({ tipo, id, estado }) {
  const [actual, setActual] = useState(estado);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");

  async function cambiar(accion) {
    setOcupado(true);
    setAviso("");
    const r = await fetch("/api/monitoreo/pedir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, tipo, id }),
    });
    const d = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
    setOcupado(false);
    if (!r.ok || d.error) {
      setAviso(d.error || "No se pudo completar.");
      return;
    }
    if (accion === "quitar") setActual("quitado");
    else if (d.estado === "listo") setActual("impacto");
    else {
      setActual("pendiente");
      setAviso(d.alMomento ? "La IA lo analiza ahora; aparecerá en el reporte en unos minutos." : "Se analizará en la próxima ejecución automática (esta madrugada).");
    }
  }

  return (
    <span className="etiquetas">
      <span className={`etq ${actual === "impacto" ? "ley" : "gris"}`}>{ETIQUETA[actual] || ""}</span>
      {(actual === "sin_impacto" || actual === "quitado") && (
        <button className="boton sec chico" type="button" disabled={ocupado} onClick={() => cambiar("pasar")}>
          {ocupado ? "Un momento…" : "Pasar a impacto empresarial"}
        </button>
      )}
      {actual === "impacto" && (
        <button className="boton sec chico" type="button" disabled={ocupado} onClick={() => cambiar("quitar")}>
          {ocupado ? "Un momento…" : "Quitar de impacto empresarial"}
        </button>
      )}
      {aviso && <span className="ia-aviso">{aviso}</span>}
    </span>
  );
}
