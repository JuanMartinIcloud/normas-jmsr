import { redirect } from "next/navigation";
import { usuarioActual, exigirUsuario } from "../../../../lib/auth";
import { consultar } from "../../../../lib/db";
import AdminUsuarios from "./AdminUsuarios";

export const metadata = { title: "Usuarios · Monitoreo empresarial" };

export default async function Usuarios() {
  await exigirUsuario();
  const u = await usuarioActual();
  if (!u || u.rol !== "admin") redirect("/monitoreo");
  const lista = await consultar(`SELECT id, usuario, nombre, rol, activo, creado_en::date::text AS creado FROM usuarios ORDER BY creado_en`);
  return (
    <>
      <h1>Usuarios</h1>
      <p className="sub">Quienes pueden entrar al sistema (buscador y monitoreo). Los editores pueden quitar ítems y aprobar o enviar el informe; el administrador además gestiona usuarios y destinatarios.</p>
      <AdminUsuarios lista={lista} yo={u.id} />
    </>
  );
}
