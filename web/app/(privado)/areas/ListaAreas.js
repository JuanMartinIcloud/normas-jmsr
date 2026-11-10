"use client";

import { useState } from "react";

// Lista de areas con casillas: se pueden marcar varias y ver un reporte por cada una
export default function ListaAreas({ areas, mes }) {
  const [marcadas, setMarcadas] = useState([]);
  const cambiar = (id) => setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  return (
    <>
      <div className="areas-grilla">
        {areas.map((a) => (
          <label key={a.id} className="area-item">
            <input type="checkbox" checked={marcadas.includes(a.id)} onChange={() => cambiar(a.id)} />
            <span>
              <a href={`/areas/${a.id}?mes=${mes}`}>{a.nombre}</a>
              {a.origen === "usuario" && <span className="etq gris">agregada</span>}
              <small>{a.descripcion}</small>
            </span>
          </label>
        ))}
      </div>
      <p>
        <a
          className={`boton ${marcadas.length ? "" : "desactivado"}`}
          href={marcadas.length ? `/areas/varias?ids=${marcadas.join(",")}&mes=${mes}` : undefined}
          aria-disabled={!marcadas.length}
        >
          Ver los reportes de las {marcadas.length || ""} áreas marcadas
        </a>
      </p>
    </>
  );
}
