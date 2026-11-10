"use client";

import { useEffect, useState } from "react";
import { seleccionActual, guardarSeleccion, alCambiar, MAXIMO } from "./seleccion";

// Casilla "Seleccionar" de cada norma o proyecto
export default function Marcar({ tipo, id, etiqueta }) {
  const [marcado, setMarcado] = useState(false);
  const clave = `${tipo}${id}`;

  useEffect(() => {
    const revisar = () => setMarcado(seleccionActual().some((x) => `${x.t}${x.id}` === clave));
    revisar();
    return alCambiar(revisar);
  }, [clave]);

  function cambiar(e) {
    const lista = seleccionActual().filter((x) => `${x.t}${x.id}` !== clave);
    if (e.target.checked) {
      if (lista.length >= MAXIMO) {
        alert(`Puedes seleccionar hasta ${MAXIMO} documentos a la vez.`);
        return;
      }
      lista.push({ t: tipo, id: String(id), e: etiqueta });
    }
    guardarSeleccion(lista);
  }

  return (
    <label className="marcar">
      <input type="checkbox" checked={marcado} onChange={cambiar} /> Seleccionar
    </label>
  );
}
