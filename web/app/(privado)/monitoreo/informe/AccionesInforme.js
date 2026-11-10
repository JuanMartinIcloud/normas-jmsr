"use client";

import { useState } from "react";

export default function AccionesInforme({ fecha, estado, correoListo, hayDestinatarios, total }) {
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState("");

  async function hacer(accion) {
    setOcupado(true);
    setMensaje("");
    const r = await fetch("/api/monitoreo/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, fecha }),
    });
    const d = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
    setOcupado(false);
    if (!r.ok || d.error) {
      setMensaje(d.error || "No se pudo completar.");
      return;
    }
    if (accion === "enviar") setMensaje(`Enviado: ${d.enviados.join(", ")}.`);
    window.setTimeout(() => window.location.reload(), accion === "enviar" ? 2500 : 300);
  }

  const e = estado.estado || "borrador";
  return (
    <div className="grafico" style={{ marginBottom: 16 }}>
      <p>
        <strong>Estado:</strong>{" "}
        {e === "borrador" && "Borrador (sin aprobar)"}
        {e === "aprobado" && `Aprobado por ${estado.aprobado_por}`}
        {e === "enviado" && `Enviado (aprobado por ${estado.aprobado_por})`}
      </p>
      <div className="acciones">
        {e === "borrador" && (
          <button className="boton" type="button" disabled={ocupado || !total} onClick={() => hacer("aprobar")}>
            Aprobar informe
          </button>
        )}
        {e !== "borrador" && (
          <button className="boton sec" type="button" disabled={ocupado} onClick={() => hacer("reabrir")}>
            Volver a borrador
          </button>
        )}
        {e === "aprobado" && (
          <button className="boton" type="button" disabled={ocupado || !correoListo || !hayDestinatarios} onClick={() => hacer("enviar")}>
            {ocupado ? "Enviando…" : "Enviar por correo"}
          </button>
        )}
      </div>
      {!correoListo && <p className="ia-pendiente">El envío por correo todavía no está configurado (falta la cuenta de correo que envía).</p>}
      {correoListo && !hayDestinatarios && <p className="ia-pendiente">Faltan los destinatarios (abajo, sección Destinatarios).</p>}
      {mensaje && <p className="ia-aviso">{mensaje}</p>}
    </div>
  );
}
