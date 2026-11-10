// Graficos de barras horizontales en SVG (se dibujan en el servidor, sin librerias)
const COLORES = {
  Favorable: "#2f8f4e", Desfavorable: "#c0392b", "Para seguimiento": "#d4a017",
  Alto: "#8f1d2c", Moderado: "#c46b2d", Bajo: "#7a8a99",
};

// enlace(etiqueta) -> direccion a la que lleva cada barra al pulsarla (opcional)
export function Barras({ titulo, datos, maximo = 12, colorBase = "#8f1d2c", enlace = null }) {
  const filas = datos.filter((d) => d.valor > 0).slice(0, maximo);
  const tope = Math.max(1, ...filas.map((d) => d.valor));
  const alto = 26;
  const anchoEtq = 210;
  const anchoBarra = 260;
  return (
    <div className="grafico">
      <h3>{titulo}</h3>
      {enlace && filas.length > 0 && <p className="ayuda-grafico">Pulsa una barra para ver esos documentos.</p>}
      {filas.length === 0 ? (
        <p className="vacio">Sin datos.</p>
      ) : (
        <svg viewBox={`0 0 ${anchoEtq + anchoBarra + 50} ${filas.length * alto + 6}`} role="img" aria-label={titulo} style={{ width: "100%", height: "auto" }}>
          {filas.map((d, i) => {
            const w = Math.max(2, (d.valor / tope) * anchoBarra);
            const y = i * alto + 4;
            const barra = (
              <g>
                <title>{enlace ? `Ver ${d.valor}: ${d.etiqueta}` : `${d.etiqueta}: ${d.valor}`}</title>
                <rect x="0" y={y - 2} width={anchoEtq + anchoBarra + 50} height={alto} fill="transparent" />
                <text x={anchoEtq - 8} y={y + 15} textAnchor="end" fontSize="12" fill={enlace ? "#8f1d2c" : "#333"}
                  textDecoration={enlace ? "underline" : undefined}>
                  {d.etiqueta.length > 32 ? `${d.etiqueta.slice(0, 31)}…` : d.etiqueta}
                </text>
                <rect x={anchoEtq} y={y} width={w} height={alto - 8} rx="3" fill={COLORES[d.etiqueta] || colorBase} />
                <text x={anchoEtq + w + 6} y={y + 14} fontSize="12" fill="#333">{d.valor}</text>
              </g>
            );
            return enlace ? (
              <a key={d.etiqueta} href={enlace(d.etiqueta)} style={{ cursor: "pointer" }}>{barra}</a>
            ) : (
              <g key={d.etiqueta}>{barra}</g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function contar(items, campo) {
  const m = new Map();
  for (const it of items) {
    const v = it[campo];
    const lista = Array.isArray(v) ? v : [v];
    for (const x of lista) if (x) m.set(x, (m.get(x) || 0) + 1);
  }
  return [...m.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor })).sort((a, b) => b.valor - a.valor);
}
