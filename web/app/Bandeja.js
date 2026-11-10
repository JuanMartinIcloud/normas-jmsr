"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { seleccionActual, guardarSeleccion, alCambiar } from "./seleccion";

// Barra fija abajo que aparece cuando hay documentos seleccionados
export default function Bandeja() {
  const [lista, setLista] = useState([]);
  const ruta = usePathname();

  useEffect(() => {
    const revisar = () => setLista(seleccionActual());
    revisar();
    return alCambiar(revisar);
  }, []);

  // En la pagina de union la lista ya se muestra completa
  if (!lista.length || ruta === "/unir") return null;
  const normas = lista.filter((x) => x.t === "N").length;
  const proyectos = lista.filter((x) => x.t === "P").length;
  const partes = [];
  if (normas) partes.push(`${normas} ${normas === 1 ? "norma" : "normas"}`);
  if (proyectos) partes.push(`${proyectos} ${proyectos === 1 ? "proyecto" : "proyectos"}`);

  return (
    <div className="bandeja" role="region" aria-label="Documentos seleccionados">
      <span className="bandeja-texto">Seleccionados: {partes.join(" y ")}</span>
      <div className="bandeja-acciones">
        {lista.length >= 2 && (
          <a className="boton" href="/unir?accion=unir">Unir en un texto</a>
        )}
        {proyectos >= 2 && (
          <a className="boton" href="/unir?accion=proyecto">Proponer proyecto unificado</a>
        )}
        {lista.length < 2 && <span className="bandeja-ayuda">Marca al menos 2 documentos</span>}
        <button className="boton sec" type="button" onClick={() => guardarSeleccion([])}>Vaciar</button>
      </div>
    </div>
  );
}
