"use client";

import { useState } from "react";

export default function AdminUsuarios({ lista, yo }) {
  const [msg, setMsg] = useState("");

  async function pedir(cuerpo) {
    setMsg("");
    const r = await fetch("/api/monitoreo/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) {
      setMsg(d.error || "No se pudo completar.");
      return false;
    }
    window.location.reload();
    return true;
  }

  async function crear(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget).entries());
    await pedir({ accion: "crear", ...d });
  }

  async function cambiarClave(id) {
    const clave = window.prompt("Nueva contraseña (mínimo 8 caracteres):");
    if (clave) await pedir({ accion: "clave", id, clave });
  }

  return (
    <>
      <div className="envoltura-tabla">
        <table className="tabla-mon">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Desde</th><th></th></tr></thead>
          <tbody>
            {lista.map((x) => (
              <tr key={x.id}>
                <td>{x.nombre}</td><td>{x.usuario}</td><td>{x.rol === "admin" ? "Administrador" : "Editor"}</td>
                <td>{x.activo ? "Activo" : "Desactivado"}</td><td>{x.creado}</td>
                <td>
                  <button type="button" className="enlace-btn" onClick={() => cambiarClave(x.id)}>Cambiar contraseña</button>
                  {x.id !== yo && (
                    <>
                      {" · "}
                      <button type="button" className="enlace-btn" onClick={() => pedir({ accion: "activo", id: x.id, activo: !x.activo })}>
                        {x.activo ? "Desactivar" : "Activar"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="seccion">Crear usuario</h2>
      <form className="filtros" onSubmit={crear}>
        <label>Nombre<input name="nombre" required /></label>
        <label>Usuario<input name="usuario" required placeholder="Ej.: maria.lopez" /></label>
        <label>Contraseña inicial<input name="clave" type="password" required minLength={8} /></label>
        <label>
          Rol
          <select name="rol" defaultValue="editor">
            <option value="editor">Editor</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <div className="acciones"><button className="boton" type="submit">Crear usuario</button></div>
      </form>
      {msg && <p className="ia-aviso">{msg}</p>}
    </>
  );
}
