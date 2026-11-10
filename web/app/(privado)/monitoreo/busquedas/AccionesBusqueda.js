"use client";

import { useState } from "react";

const FRECUENCIAS = [
  ["diaria", "Diaria"], ["semanal", "Semanal"], ["quincenal", "Quincenal"], ["mensual", "Mensual"],
];

async function pedir(cuerpo) {
  const r = await fetch("/api/busquedas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "No se pudo completar.");
  return d;
}

export default function AccionesBusqueda({ b }) {
  const [msg, setMsg] = useState("");
  const [editar, setEditar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function hacer(cuerpo, recargar = true) {
    setOcupado(true);
    setMsg("");
    try {
      const d = await pedir({ id: b.id, ...cuerpo });
      if (cuerpo.accion === "ejecutar") setMsg(`Listo: ${d.total_normas} normas y ${d.total_proyectos} proyectos.`);
      if (recargar) window.setTimeout(() => window.location.reload(), cuerpo.accion === "ejecutar" ? 1500 : 200);
    } catch (e) {
      setMsg(e.message);
    }
    setOcupado(false);
  }

  async function guardar(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget).entries());
    await hacer({ accion: "editar", nombre: d.nombre, frecuencia: d.frecuencia, destinatarios: d.destinatarios, con_resumen: d.con_resumen === "1" });
  }

  return (
    <>
      <button type="button" className="boton sec chico" disabled={ocupado} onClick={() => hacer({ accion: "ejecutar" })}>
        {ocupado ? "Ejecutando…" : "Ejecutar ahora"}
      </button>
      <button type="button" className="boton sec chico" disabled={ocupado} onClick={() => hacer({ accion: "activa", activa: !b.activa })}>
        {b.activa ? "Pausar" : "Activar"}
      </button>
      <button type="button" className="boton sec chico" onClick={() => setEditar(!editar)}>Editar</button>
      <button
        type="button"
        className="boton sec chico"
        disabled={ocupado}
        onClick={() => window.confirm(`¿Eliminar la búsqueda «${b.nombre}» y todos sus resultados?`) && hacer({ accion: "eliminar" })}
      >
        Eliminar
      </button>
      {msg && <span className="ia-pendiente">{msg}</span>}
      {editar && (
        <form className="filtros" onSubmit={guardar} style={{ width: "100%" }}>
          <label className="ancho">Nombre<input name="nombre" defaultValue={b.nombre} required /></label>
          <label>
            Frecuencia
            <select name="frecuencia" defaultValue={b.frecuencia}>
              {FRECUENCIAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label>Enviar a<input name="destinatarios" defaultValue={b.destinatarios.join(", ")} placeholder="correo@empresa.com" /></label>
          <label className="ancho check">
            <input type="checkbox" name="con_resumen" value="1" defaultChecked={b.con_resumen} />
            Incluir resumen con IA en cada resultado
          </label>
          <div className="acciones"><button className="boton" type="submit">Guardar cambios</button></div>
        </form>
      )}
    </>
  );
}
