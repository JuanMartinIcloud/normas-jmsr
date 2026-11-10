"use client";

import { useState } from "react";

const FRECUENCIAS = [
  ["diaria", "Diaria (lo publicado el día anterior)"],
  ["semanal", "Semanal (cada lunes, la semana anterior)"],
  ["quincenal", "Quincenal (días 1 y 16, la quincena anterior)"],
  ["mensual", "Mensual (el día 1, el mes anterior)"],
];

// Guarda la busqueda actual para que se ejecute sola con la frecuencia elegida
export default function GuardarBusqueda({ pregunta = "", q = "", terminos = [], refinar = [] }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");

  async function guardar(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget).entries());
    setEstado("guardando");
    setError("");
    const r = await fetch("/api/busquedas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "crear", nombre: d.nombre, frecuencia: d.frecuencia, destinatarios: d.destinatarios, pregunta, q, terminos, refinar }),
    });
    const res = await r.json().catch(() => ({}));
    if (r.status === 401) {
      window.location.href = `/ingresar?volver=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    if (!r.ok || res.error) {
      setError(res.error || "No se pudo guardar.");
      setEstado("");
      return;
    }
    setEstado("guardado");
  }

  if (estado === "guardado") {
    return (
      <p className="ia-aviso">
        Búsqueda guardada. Puedes verla, cambiar su frecuencia o ejecutarla en{" "}
        <a href="/monitoreo/busquedas">Monitoreo › Búsquedas guardadas</a>.
      </p>
    );
  }
  if (!abierto) {
    return (
      <div className="ia-boton">
        <button className="boton sec" type="button" onClick={() => setAbierto(true)}>★ Guardar esta búsqueda</button>
        <p className="ia-pendiente">Se ejecutará sola (diaria, semanal, quincenal o mensual) y guardará cada resultado con un resumen.</p>
      </div>
    );
  }
  return (
    <form className="filtros" onSubmit={guardar}>
      <label className="ancho">
        Nombre de la búsqueda
        <input name="nombre" required defaultValue={(pregunta || q).slice(0, 120)} />
      </label>
      <label>
        Frecuencia
        <select name="frecuencia" defaultValue="diaria">
          {FRECUENCIAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <label>
        Enviar el resultado a (opcional)
        <input name="destinatarios" placeholder="correo1@empresa.com, correo2@empresa.com" />
      </label>
      <div className="acciones">
        <button className="boton" type="submit" disabled={estado === "guardando"}>{estado === "guardando" ? "Guardando…" : "Guardar búsqueda"}</button>
        <button className="boton sec" type="button" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      {error && <p className="ia-aviso ancho">{error}</p>}
    </form>
  );
}
