"use client";

import { useState } from "react";

// "Filtrar dentro de estos resultados": agrega un filtro mas (se pueden poner varios seguidos)
export default function FiltrarResultados({ ruta = "/buscar", params = {}, refinar = [], maximo = 5 }) {
  const [valor, setValor] = useState("");

  function aplicar(e) {
    e.preventDefault();
    const x = valor.replace(/[|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!x) return;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    p.set("y", [...refinar, x].join("|"));
    p.delete("p");
    window.location.href = `${ruta}?${p.toString()}`;
  }

  if (refinar.length >= maximo) {
    return <p className="ia-pendiente">Llegaste al máximo de {maximo} filtros. Quita alguno para agregar otro.</p>;
  }
  return (
    <form className="refinar" onSubmit={aplicar}>
      <label>
        {refinar.length ? "Agregar otro filtro dentro de estos resultados" : "Filtrar dentro de estos resultados"}
        <input
          type="search"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Ej.: minería, MYPE, tributario"
        />
      </label>
      <button className="boton sec" type="submit">Filtrar</button>
    </form>
  );
}
