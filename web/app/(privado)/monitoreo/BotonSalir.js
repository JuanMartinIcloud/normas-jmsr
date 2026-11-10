"use client";

export default function BotonSalir() {
  async function salir() {
    await fetch("/api/sesion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "salir" }) });
    window.location.href = "/ingresar";
  }
  return (
    <button type="button" className="enlace-btn" onClick={salir}>
      Salir
    </button>
  );
}
