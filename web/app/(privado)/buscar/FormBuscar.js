"use client";

import { useEffect, useState } from "react";

const CLAVE_MODO = "normas-peru-buscar-con-ia";

// Formulario principal de "Buscar en todo". Con "Buscar con IA" (activado por defecto) la IA
// interpreta lo escrito en lenguaje natural y lo convierte en una busqueda de expresiones clave.
export default function FormBuscar({ texto = "", desde = "", hasta = "" }) {
  const [conIA, setConIA] = useState(true);
  const [estado, setEstado] = useState("listo");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(CLAVE_MODO);
      if (v === "0") setConIA(false);
    } catch {}
  }, []);

  function cambiarModo(v) {
    setConIA(v);
    try {
      window.localStorage.setItem(CLAVE_MODO, v ? "1" : "0");
    } catch {}
  }

  async function enviar(e) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    const q = String(datos.get("q") || "").replace(/\s+/g, " ").trim();
    const d = String(datos.get("desde") || "");
    const h = String(datos.get("hasta") || "");
    const p = new URLSearchParams();
    if (!conIA || !q) {
      if (q) p.set("q", q);
      if (d) p.set("desde", d);
      if (h) p.set("hasta", h);
      window.location.href = `/buscar${p.toString() ? `?${p}` : ""}`;
      return;
    }
    setEstado("cargando");
    setError("");
    try {
      const r = await fetch("/api/ia/interpretar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const res = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
      if (!r.ok || res.error) throw new Error(res.error || `Error del servidor (HTTP ${r.status})`);
      p.set("pregunta", q);
      p.set("t", res.terminos.join("|"));
      p.set("orden", "r");
      // Las fechas escritas por el usuario mandan sobre las que deduzca la IA
      if (d || res.desde) p.set("desde", d || res.desde);
      if (h || res.hasta) p.set("hasta", h || res.hasta);
      window.location.href = `/buscar?${p.toString()}`;
    } catch (err) {
      // Si la IA no responde, se busca igual por las palabras escritas (sin mostrar un error)
      const s = new URLSearchParams();
      s.set("q", q);
      if (d) s.set("desde", d);
      if (h) s.set("hasta", h);
      s.set("sinia", "1");
      window.location.href = `/buscar?${s.toString()}`;
    }
  }

  return (
    <form className="filtros" onSubmit={enviar}>
      <label className="ancho">
        ¿Qué buscas?
        <input
          type="search"
          name="q"
          defaultValue={texto}
          placeholder={conIA ? "Ej.: normas que afecten a las inversiones privadas en minería" : "Ej.: violencia juvenil, teletrabajo, Ley 32513"}
        />
      </label>
      <label>
        Desde
        <input type="date" name="desde" defaultValue={desde} />
      </label>
      <label>
        Hasta
        <input type="date" name="hasta" defaultValue={hasta} />
      </label>
      <label className="ancho check">
        <input type="checkbox" checked={conIA} onChange={(e) => cambiarModo(e.target.checked)} />
        Buscar con IA: escribe con tus palabras y la IA elige los términos legales para buscar
      </label>
      <div className="acciones">
        <button className="boton" type="submit" disabled={estado === "cargando"}>
          {estado === "cargando" ? "La IA está interpretando tu búsqueda…" : "Buscar"}
        </button>
        <a className="boton sec" href="/buscar">Limpiar</a>
      </div>
      {estado === "error" && <p className="ia-aviso ancho">{error}</p>}
    </form>
  );
}
