import { neon } from "@neondatabase/serverless";
import { unstable_cache, revalidateTag } from "next/cache";

// Bases de datos del sistema (todas en Neon, plan gratuito; ver src/bases.py):
// - Principal: TEXTOS_URL_4 (normas, proyectos, analisis, usuarios).
// - De texto: TEXTOS_URL_2, 3, 5 a 12 (texto completo de normas y proyectos, tabla "documentos").
//   La 1 se retiro: su contenido se copio a la 12.

export const URL_PRINCIPAL = (process.env.TEXTOS_URL_4 || process.env.DATABASE_URL || "").trim();

export function ejecutar(url, texto, params = []) {
  const sql = neon(url, { fetchOptions: { cache: "no-store" } });
  // Versiones nuevas del paquete usan sql.query(texto, params); las 0.x aceptan sql(texto, params)
  if (typeof sql.query === "function") return sql.query(texto, params);
  return sql(texto, params);
}

// Bases de texto: [{ numero, url }]
export function basesTexto() {
  const lista = [];
  for (let i = 1; i <= 12; i++) {
    if (i === 4) continue; // la 4 es la principal
    if (i === 1 && (process.env.TEXTOS_URL_12 || "").trim()) continue; // la 1 se copio a la 12
    const url = (process.env[`TEXTOS_URL_${i}`] || "").trim();
    if (url) lista.push({ numero: i, url });
  }
  return lista;
}

// Resultados guardados: una misma consulta no vuelve a pedirse a la base mientras su resultado este vigente.
// Las normas y proyectos se cargan una vez al dia (de madrugada), asi que un resultado sirve por un buen rato.
// - "catalogos": listas de años, sectores, rubros, tipos, estados... (6 horas)
// - "datos": listas y conteos de normas, proyectos y resumenes; texto completo (30 minutos)
// - "monitoreo": reportes del monitoreo (30 minutos; se renuevan al momento cuando alguien quita o
//   devuelve un item, o cambia el informe)
const VIGENCIA = { catalogos: 6 * 3600, datos: 1800, monitoreo: 1800 };
const guardadas = Object.fromEntries(
  Object.entries(VIGENCIA).map(([tipo, segundos]) => [
    tipo,
    // La clave del resultado guardado es la consulta y sus parametros (nunca la cadena de conexion)
    unstable_cache(async (texto, params) => ejecutar(URL_PRINCIPAL, texto, params), [`consulta-${tipo}-v1`], {
      revalidate: segundos,
      tags: [tipo],
    }),
  ])
);

// Consulta de solo lectura a la base principal, con su resultado guardado segun el tipo
export function ejecutarGuardado(texto, params = [], tipo = "datos") {
  return (guardadas[tipo] || guardadas.datos)(texto, params);
}

// Descarta los resultados guardados de un tipo (por ejemplo, tras quitar un item del monitoreo)
export function renovar(tipo) {
  revalidateTag(tipo);
}
