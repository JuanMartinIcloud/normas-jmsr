import { volverSeguro } from "../../lib/volver";
import FormIngresar from "./FormIngresar";

export const metadata = { title: "Ingresar · Normas Legales del Perú" };

// Todo el sitio exige usuario y contraseña. Las cuentas las crea el administrador (Monitoreo → Usuarios).
export default async function Ingresar({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  const volver = volverSeguro(searchParams?.volver);
  return (
    <main className="contenedor angosto">
      <h1>Ingresar</h1>
      <p className="sub">Normas legales, proyectos de ley y monitoreo empresarial.</p>
      <FormIngresar volver={volver} />
    </main>
  );
}
