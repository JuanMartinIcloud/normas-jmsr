import { redirect } from "next/navigation";
import { usuarioActual } from "../../../lib/auth";
import BotonSalir from "./BotonSalir";

export const metadata = { title: "Herramientas" };

// Todo el modulo exige haber ingresado con usuario y contraseña (ya lo revisa app/(privado)/layout.js;
// aqui se lee el usuario para mostrar su nombre y, si es administrador, la pagina de usuarios)
export default async function LayoutMonitoreo({ children }) {
  let u = null;
  try {
    u = await usuarioActual();
  } catch (e) {
    u = null;
  }
  if (!u) redirect("/ingresar?volver=%2Fmonitoreo");
  return (
    <main className="contenedor">
      <div className="barra-mon">
        <strong>Herramientas</strong>
        <span className="usuario-mon">
          {u.nombre} · <BotonSalir />
        </span>
      </div>
      <nav className="atajos" aria-label="Monitoreo">
        <a className="atajo" href="/areas">Monitoreo por áreas</a>
        <a className="atajo" href="/monitoreo/busquedas">Búsquedas guardadas</a>
        <a className="atajo" href="/monitoreo/control">Control de calidad</a>
        {u.rol === "admin" && <a className="atajo" href="/monitoreo/usuarios">Usuarios</a>}
        <a className="atajo" href="/">Buscador →</a>
      </nav>
      {children}
    </main>
  );
}
