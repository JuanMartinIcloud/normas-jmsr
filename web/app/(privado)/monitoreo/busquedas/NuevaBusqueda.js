"use client";

import { useState } from "react";

// Crea una busqueda guardada a partir de una pregunta en lenguaje natural (la IA elige los terminos)
export default function NuevaBusqueda() {
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");

  async function crear(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget).entries());
    setError("");
    try {
      setEstado("La IA está interpretando la pregunta…");
      // Si la IA no responde, la busqueda se guarda igual con las palabras escritas
      let i = { terminos: [] };
      try {
        const r1 = await fetch("/api/ia/interpretar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: d.pregunta }) });
        const res = await r1.json().catch(() => ({}));
        if (r1.ok && !res.error && Array.isArray(res.terminos) && res.terminos.length) i = res;
      } catch {}
      const sinIA = !i.terminos.length;
      setEstado("Guardando…");
      const r2 = await fetch("/api/busquedas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "crear", nombre: d.nombre || d.pregunta, pregunta: sinIA ? "" : d.pregunta, q: sinIA ? d.pregunta : "", terminos: i.terminos,
          refinar: d.filtros ? d.filtros.split(",").map((x) => x.trim()).filter(Boolean) : [],
          frecuencia: d.frecuencia, destinatarios: d.destinatarios,
        }),
      });
      const g = await r2.json().catch(() => ({}));
      if (!r2.ok || g.error) throw new Error(g.error || "No se pudo guardar.");
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setEstado("");
    }
  }

  return (
    <form className="filtros" onSubmit={crear}>
      <label className="ancho">
        ¿Qué quieres vigilar? (escribe con tus palabras)
        <input name="pregunta" required placeholder="Ej.: cambios tributarios que afecten a las empresas mineras" />
      </label>
      <label className="ancho">
        Nombre (opcional)
        <input name="nombre" placeholder="Ej.: Tributación minera" />
      </label>
      <label>
        Frecuencia
        <select name="frecuencia" defaultValue="diaria">
          <option value="diaria">Diaria</option>
          <option value="semanal">Semanal (lunes)</option>
          <option value="quincenal">Quincenal (días 1 y 16)</option>
          <option value="mensual">Mensual (día 1)</option>
        </select>
      </label>
      <label>
        Filtros adicionales (opcional, separados por comas)
        <input name="filtros" placeholder="Ej.: regalías, IGV" />
      </label>
      <label className="ancho">
        Enviar el resultado a (opcional)
        <input name="destinatarios" placeholder="correo1@empresa.com, correo2@empresa.com" />
      </label>
      <div className="acciones">
        <button className="boton" type="submit" disabled={Boolean(estado)}>{estado || "Crear búsqueda guardada"}</button>
      </div>
      {error && <p className="ia-aviso ancho">{error}</p>}
    </form>
  );
}
