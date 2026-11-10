// Direccion a la que se vuelve despues de ingresar. Solo se aceptan direcciones de este mismo sitio
// ("/algo"); se rechazan "//otro-sitio" y "/\otro-sitio", que el navegador llevaria a otro dominio.
export function volverSeguro(v) {
  const s = typeof v === "string" ? v : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || /[\r\n]/.test(s)) return "/";
  return s.slice(0, 500);
}
