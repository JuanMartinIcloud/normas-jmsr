import { estadoMes, hoyLima, nombreMes } from "../../../lib/monitoreo";
import { pedidosPendientes } from "../../../lib/pedidos";
import BotonAnalizarMes from "./BotonAnalizarMes";

// Aviso arriba de los reportes: si la IA aun no reviso todo el mes, lo dice y permite pedir que lo revise.
// El mes en curso se revisa solo cada madrugada.
export default async function AvisoMes({ mes }) {
  if (!/^\d{4}-\d{2}$/.test(mes || "")) return null;
  let e;
  let pendiente = false;
  try {
    [e, pendiente] = await Promise.all([estadoMes(mes), pedidosPendientes().then((p) => p.meses.has(mes))]);
  } catch (err) {
    console.error(err);
    return null;
  }
  const faltan = e.faltan_normas + e.faltan_proyectos;
  if (!faltan) return null;
  const actual = mes === hoyLima().slice(0, 7);
  const detalle = `faltan revisar ${e.faltan_normas.toLocaleString("es-PE")} normas de ${e.normas.toLocaleString("es-PE")} y ${e.faltan_proyectos.toLocaleString("es-PE")} proyectos de ley`;
  return (
    <div className="ia-pendiente">
      {actual ? (
        <>La IA revisa el mes en curso cada madrugada: {detalle} (lo nuevo de hoy).</>
      ) : pendiente ? (
        <>La IA está revisando {nombreMes(mes)}: {detalle}. Las cifras se completan solas a medida que avanza.</>
      ) : (
        <>
          La IA todavía no ha revisado todo {nombreMes(mes)}: {detalle}.{" "}
          <BotonAnalizarMes mes={mes} />
        </>
      )}
    </div>
  );
}
