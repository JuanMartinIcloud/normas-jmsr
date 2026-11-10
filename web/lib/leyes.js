// Proposiciones convertidas en ley y recorrido entre camaras (columnas que llena src/leyes.py)

export const CAMARA_NOMBRE = { D: "Cámara de Diputados", S: "Senado", C: "Congreso" };

// Columnas para las consultas de proyectos (alias de tabla configurable)
export const colsLey = (t = "p") =>
  `${t}.ley_tipo, ${t}.ley_numero, ${t}.ley_fecha::text AS ley_fecha, ${t}.ley_docs, ${t}.enlace_numero, ${t}.enlace_camara, ${t}.enlace_estado`;

const fechaCorta = (f) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const docs = (p) => (p && p.ley_docs && typeof p.ley_docs === "object" ? p.ley_docs : {});

// "Ley N° 32743"
export function nombreLey(p) {
  return p && p.ley_numero ? `${p.ley_tipo || "Ley"} N° ${p.ley_numero}` : "";
}

// Estado a mostrar: la ley publicada, o el estado en la otra camara, o el estado del Congreso
export function estadoProyecto(p) {
  if (!p) return "";
  if (p.ley_numero) {
    const f = fechaCorta(p.ley_fecha);
    const erratas = (docs(p).erratas || []).length;
    return `Convertida en ${nombreLey(p)}${f ? `, publicada en El Peruano el ${f}` : ""}${erratas ? ` · con fe de erratas` : ""}`;
  }
  if (p.enlace_numero && p.enlace_estado) {
    return `${p.estado || ""} → ${CAMARA_NOMBRE[p.enlace_camara] || "otra cámara"} (Proposición ${p.enlace_numero}): ${p.enlace_estado}`;
  }
  return p.estado || "";
}

// Misma iniciativa en la otra camara
export function recorrido(p) {
  if (!p || !p.enlace_numero) return "";
  const otra = CAMARA_NOMBRE[p.enlace_camara] || "la otra cámara";
  return p.camara === "S" ? `Viene de la ${otra}: Proposición ${p.enlace_numero}` : `Continúa en el ${otra === "Senado" ? "Senado" : otra}: Proposición ${p.enlace_numero}`;
}

// Enlaces a la ley y a sus fe de erratas en El Peruano
export function enlacesLey(p) {
  const d = docs(p);
  const salida = [];
  if (d.ley && d.ley.url) salida.push({ texto: `Ver ${nombreLey(p)}`, url: d.ley.url });
  for (const e of d.erratas || []) {
    if (e.url) salida.push({ texto: `Fe de erratas (${fechaCorta(e.fecha)})`, url: e.url });
  }
  return salida;
}
