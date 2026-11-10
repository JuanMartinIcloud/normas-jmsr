import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { usuarioActual } from "../../lib/auth";
import { volverSeguro } from "../../lib/volver";

// Todas las paginas del sitio (salvo "Ingresar") exigen haber ingresado con usuario y contraseña.
// (middleware.js ya desvia a quien no tiene cookie de sesion; aqui se verifica la firma y que el usuario
// exista y este activo)
export default async function LayoutPrivado({ children }) {
  let u = null;
  try {
    u = await usuarioActual();
  } catch (e) {
    console.error(e);
    return (
      <main className="contenedor angosto">
        <p className="ia-aviso">El sistema no está disponible en este momento. Intenta de nuevo en unos minutos.</p>
      </main>
    );
  }
  if (!u) redirect(`/ingresar?volver=${encodeURIComponent(volverSeguro((await headers()).get("x-ruta")))}`);
  return children;
}
