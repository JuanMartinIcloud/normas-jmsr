import { hoyLima, finDeMes, nombreMes, fechaLarga } from "./monitoreo";

// Periodo de un reporte: un mes (?mes=AAAA-MM) o un dia (?fecha=AAAA-MM-DD)
export function leerPeriodo(sp = {}) {
  const fecha = typeof sp.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : "";
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hoyLima().slice(0, 7);
  if (fecha) return { tipo: "dia", desde: fecha, hasta: fecha, nombre: fechaLarga(fecha), fecha, mes };
  return { tipo: "mes", desde: `${mes}-01`, hasta: finDeMes(mes), nombre: nombreMes(mes), fecha: "", mes };
}
