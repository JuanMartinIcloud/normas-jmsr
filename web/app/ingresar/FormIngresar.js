"use client";

import { useState } from "react";

export default function FormIngresar({ volver }) {
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");

  async function enviar(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget).entries());
    setEstado("enviando");
    setError("");
    const r = await fetch("/api/sesion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "ingresar", usuario: d.usuario, clave: d.clave }),
    });
    const res = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
    if (!r.ok || res.error) {
      setError(res.error || "No se pudo ingresar.");
      setEstado("");
      return;
    }
    window.location.href = volver;
  }

  return (
    <form className="filtros" onSubmit={enviar}>
      <label className="ancho">
        Usuario
        <input name="usuario" required autoComplete="username" />
      </label>
      <label className="ancho">
        Contraseña
        <input name="clave" type="password" required autoComplete="current-password" />
      </label>
      <div className="acciones">
        <button className="boton" type="submit" disabled={estado === "enviando"}>
          {estado === "enviando" ? "Un momento…" : "Ingresar"}
        </button>
      </div>
      {error && <p className="ia-aviso ancho">{error}</p>}
    </form>
  );
}
