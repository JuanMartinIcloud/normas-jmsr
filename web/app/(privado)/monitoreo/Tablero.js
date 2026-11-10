// Graficos del resumen ejecutivo (SVG dibujado en el servidor, sin librerias).
// Cada barra o segmento es un enlace: al pulsarlo se abren esos documentos en "Impacto".
// Colores: calificacion = verde (favorable) / gris neutro (para seguimiento) / rojo (desfavorable);
// puntaje = una sola tonalidad azul, mas oscura cuanto mayor el puntaje; normas / proyectos = azul / naranja.

export const COLOR_CAL = { Favorable: "#2f8f4e", "Para seguimiento": "#a8a29e", Desfavorable: "#c0392b" };
const ORDEN_CAL = ["Favorable", "Para seguimiento", "Desfavorable"];
const AZUL = ["#86b6ef", "#86b6ef", "#6da7ec", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];
const COLOR_ORIGEN = { N: "#2a78d6", P: "#eb6834" };
const TINTA = "#1f2328";
const TINTA2 = "#57606a";
const REJILLA = "#e6e3dc";

const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
const corto = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Rectangulo con extremo redondeado (4 px) del lado derecho y base recta
function barraH(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${w - rr} z`;
}
// Columna con extremo redondeado arriba y base recta
function columna(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} v-${h - rr} a${rr},${rr} 0 0 1 ${rr},-${rr} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - rr} z`;
}

function Leyenda({ items }) {
  return (
    <div className="leyenda">
      {items.map(([etq, color]) => (
        <span key={etq}><i style={{ background: color }} />{etq}</span>
      ))}
    </div>
  );
}

function Tarjeta({ titulo, nota, children, ancho }) {
  return (
    <section className={`panel-graf ${ancho ? "ancho" : ""}`}>
      <h3>{titulo}</h3>
      {nota && <p className="nota-graf">{nota}</p>}
      {children}
    </section>
  );
}

// 1) Balance del periodo: una sola barra al 100 % con la calificacion
export function Balance({ todos, ver }) {
  const total = todos.length;
  const datos = ORDEN_CAL.map((c) => ({ c, n: todos.filter((x) => x.calificacion === c).length })).filter((d) => d.n);
  const W = 1000;
  let x = 0;
  return (
    <Tarjeta titulo="Balance del periodo" nota="Proporción de documentos según su efecto en las empresas. Pulsa un tramo para verlos." ancho>
      {total === 0 ? <p className="vacio">Sin datos.</p> : (
        <>
          <svg viewBox={`0 0 ${W} 48`} className="svg-graf" role="img" aria-label="Balance por calificación">
            {datos.map((d, i) => {
              const w = (d.n / total) * W;
              const x0 = x;
              x += w;
              const gap = i < datos.length - 1 ? 2 : 0;
              const ancho = Math.max(1, w - gap);
              const cabe = ancho > 70;
              return (
                <a key={d.c} href={ver({ calificacion: d.c })}>
                  <title>{`${d.c}: ${d.n} (${pct(d.n, total)} %)`}</title>
                  <rect className="seg" x={x0} y="4" width={ancho} height="40" rx={i === 0 || i === datos.length - 1 ? 4 : 0} fill={COLOR_CAL[d.c]} />
                  {cabe && (
                    <text x={x0 + 10} y="30" fontSize="16" fontWeight="600" fill="#fff">{`${pct(d.n, total)} %`}</text>
                  )}
                </a>
              );
            })}
          </svg>
          <Leyenda items={datos.map((d) => [`${d.c}: ${d.n} (${pct(d.n, total)} %)`, COLOR_CAL[d.c]])} />
        </>
      )}
    </Tarjeta>
  );
}

// 2) Puntaje de impacto: columnas del 1 al 10, con los tres niveles debajo
export function Puntajes({ todos, ver }) {
  const cuenta = Array.from({ length: 10 }, (_, i) => todos.filter((x) => x.puntaje === i + 1).length);
  const sinPuntaje = todos.filter((x) => !x.puntaje).length;
  const tope = Math.max(1, ...cuenta);
  const W = 1000, H = 190, base = 150, izq = 8, paso = (W - izq * 2) / 10, ancho = Math.min(24, paso - 10);
  const niveles = [["Bajo", 1, 4], ["Moderado", 5, 7], ["Alto", 8, 10]];
  return (
    <Tarjeta titulo="Puntaje de impacto (1 a 10)" nota="Cuántos documentos hay en cada puntaje. Pulsa una columna o un nivel para verlos." ancho>
      <svg viewBox={`0 0 ${W} ${H}`} className="svg-graf" role="img" aria-label="Documentos por puntaje de impacto">
        <line x1="0" x2={W} y1={base + 0.5} y2={base + 0.5} stroke={REJILLA} />
        {cuenta.map((n, i) => {
          const h = n ? Math.max(3, (n / tope) * (base - 26)) : 0;
          const cx = izq + paso * i + paso / 2;
          return (
            <a key={i} href={ver({ puntaje_min: i + 1, puntaje_max: i + 1 })}>
              <title>{`Puntaje ${i + 1}: ${n} documentos`}</title>
              <rect x={cx - paso / 2} y="0" width={paso} height={base + 22} fill="transparent" />
              {n > 0 && <path className="seg" d={columna(cx - ancho / 2, base - h, ancho, h)} fill={AZUL[i]} />}
              {n > 0 && <text x={cx} y={base - h - 6} textAnchor="middle" fontSize="12" fill={TINTA}>{n}</text>}
              <text x={cx} y={base + 16} textAnchor="middle" fontSize="12" fill={TINTA2}>{i + 1}</text>
            </a>
          );
        })}
        {niveles.map(([nombre, a, b]) => {
          const x1 = izq + paso * (a - 1) + 4, x2 = izq + paso * b - 4;
          const n = cuenta.slice(a - 1, b).reduce((s, v) => s + v, 0);
          return (
            <a key={nombre} href={ver({ impacto: nombre })}>
              <title>{`Impacto ${nombre.toLowerCase()} (${a} a ${b}): ${n} documentos`}</title>
              <line x1={x1} x2={x2} y1={base + 26} y2={base + 26} stroke={TINTA2} strokeWidth="1" />
              <text x={(x1 + x2) / 2} y={base + 40} textAnchor="middle" fontSize="12" fontWeight="600" fill={TINTA} className="enlace-graf">
                {`${nombre}: ${n}`}
              </text>
            </a>
          );
        })}
      </svg>
      {sinPuntaje > 0 && <p className="nota-graf">{sinPuntaje} documentos aún sin puntaje (se están calificando).</p>}
    </Tarjeta>
  );
}

// 3) Evolucion diaria: normas y proyectos con impacto, apilados por dia
export function Evolucion({ todos, desde, hasta, verDia }) {
  const dias = [];
  for (let d = new Date(`${desde}T12:00:00Z`); d <= new Date(`${hasta}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  if (dias.length < 2) return null;
  const fechaDe = (x) => (x.origen === "N" ? x.fecha : x.mov_fecha || x.fecha_presentacion);
  const datos = dias.map((d) => ({
    d,
    N: todos.filter((x) => x.origen === "N" && fechaDe(x) === d).length,
    P: todos.filter((x) => x.origen === "P" && fechaDe(x) === d).length,
  }));
  const tope = Math.max(1, ...datos.map((x) => x.N + x.P));
  const W = 1000, H = 200, base = 165, izq = 30, paso = (W - izq - 10) / dias.length, ancho = Math.min(24, paso - 4);
  const marcas = [0, Math.round(tope / 2), tope];
  return (
    <Tarjeta titulo="Documentos con impacto por día" nota="Normas legales y proyectos de ley de cada día. Pulsa una columna para ver ese día." ancho>
      <Leyenda items={[["Normas legales", COLOR_ORIGEN.N], ["Proyectos de ley", COLOR_ORIGEN.P]]} />
      <svg viewBox={`0 0 ${W} ${H}`} className="svg-graf" role="img" aria-label="Documentos con impacto por día">
        {marcas.map((m) => {
          const y = base - (m / tope) * (base - 20);
          return (
            <g key={m}>
              <line x1={izq} x2={W} y1={y + 0.5} y2={y + 0.5} stroke={REJILLA} />
              <text x={izq - 6} y={y + 4} textAnchor="end" fontSize="11" fill={TINTA2}>{m}</text>
            </g>
          );
        })}
        {datos.map((x, i) => {
          const cx = izq + paso * i + paso / 2;
          const hN = (x.N / tope) * (base - 20);
          const hP = (x.P / tope) * (base - 20);
          const dia = Number(x.d.slice(8));
          return (
            <a key={x.d} href={verDia(x.d)}>
              <title>{`${x.d}: ${x.N} normas y ${x.P} proyectos`}</title>
              <rect x={cx - paso / 2} y="0" width={paso} height={base + 20} fill="transparent" />
              {x.N > 0 && <path className="seg" d={x.P > 0 ? `M${cx - ancho / 2},${base} v-${hN} h${ancho} v${hN} z` : columna(cx - ancho / 2, base - hN, ancho, hN)} fill={COLOR_ORIGEN.N} />}
              {x.P > 0 && <path className="seg" d={columna(cx - ancho / 2, base - hN - hP - (x.N ? 2 : 0), ancho, hP)} fill={COLOR_ORIGEN.P} />}
              {(dia === 1 || dia % 5 === 0 || dias.length <= 10) && (
                <text x={cx} y={base + 16} textAnchor="middle" fontSize="11" fill={TINTA2}>{dia}</text>
              )}
            </a>
          );
        })}
      </svg>
    </Tarjeta>
  );
}

// 4) Sectores: barras horizontales apiladas por calificacion (los 10 con mas documentos)
export function Sectores({ todos, ver }) {
  const m = new Map();
  for (const x of todos) if (x.sector) m.set(x.sector, (m.get(x.sector) || 0) + 1);
  const filas = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const tope = Math.max(1, ...filas.map((f) => f[1]));
  const W = 520, etq = 190, alto = 28, anchoMax = W - etq - 40;
  return (
    <Tarjeta titulo="Sectores más afectados" nota="Documentos por sector, con su calificación. Pulsa un tramo para verlos.">
      <Leyenda items={ORDEN_CAL.map((c) => [c, COLOR_CAL[c]])} />
      <svg viewBox={`0 0 ${W} ${filas.length * alto + 4}`} className="svg-graf" role="img" aria-label="Sectores por calificación">
        {filas.map(([sector, total], i) => {
          const y = i * alto + 4;
          let x = etq;
          const partes = ORDEN_CAL.map((c) => ({ c, n: todos.filter((t) => t.sector === sector && t.calificacion === c).length })).filter((p) => p.n);
          return (
            <g key={sector}>
              <a href={ver({ sector })}>
                <title>{`${sector}: ${total} documentos`}</title>
                <text x={etq - 8} y={y + 15} textAnchor="end" fontSize="12" fill={TINTA} className="enlace-graf">{corto(sector, 30)}</text>
              </a>
              {partes.map((p, j) => {
                const w = (p.n / tope) * anchoMax;
                const x0 = x;
                x += w;
                const ultimo = j === partes.length - 1;
                const ancho = Math.max(1, w - (ultimo ? 0 : 2));
                return (
                  <a key={p.c} href={ver({ sector, calificacion: p.c })}>
                    <title>{`${sector} · ${p.c}: ${p.n}`}</title>
                    <path className="seg" d={ultimo ? barraH(x0, y, ancho, 20) : `M${x0},${y} h${ancho} v20 h-${ancho} z`} fill={COLOR_CAL[p.c]} />
                  </a>
                );
              })}
              <text x={x + 6} y={y + 15} fontSize="12" fill={TINTA}>{total}</text>
            </g>
          );
        })}
      </svg>
    </Tarjeta>
  );
}

// 5) Comites de AmCham: barras horizontales de una sola serie
export function Comites({ todos, ver }) {
  const m = new Map();
  for (const x of todos) for (const c of x.comites || []) m.set(c, (m.get(c) || 0) + 1);
  const filas = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const tope = Math.max(1, ...filas.map((f) => f[1]));
  const W = 520, etq = 190, alto = 28, anchoMax = W - etq - 40;
  return (
    <Tarjeta titulo="Comités con más temas" nota="Documentos que interesan a cada comité. Pulsa una barra para verlos.">
      <svg viewBox={`0 0 ${W} ${filas.length * alto + 4}`} className="svg-graf" role="img" aria-label="Documentos por comité">
        {filas.map(([comite, n], i) => {
          const y = i * alto + 4;
          const w = Math.max(3, (n / tope) * anchoMax);
          return (
            <a key={comite} href={ver({ comite })}>
              <title>{`Comité ${comite}: ${n} documentos`}</title>
              <rect x="0" y={y - 3} width={W} height={alto - 2} fill="transparent" />
              <text x={etq - 8} y={y + 15} textAnchor="end" fontSize="12" fill={TINTA} className="enlace-graf">{corto(comite, 30)}</text>
              <path className="seg" d={barraH(etq, y, w, 20)} fill="#2a78d6" />
              <text x={etq + w + 6} y={y + 15} fontSize="12" fill={TINTA}>{n}</text>
            </a>
          );
        })}
      </svg>
    </Tarjeta>
  );
}

// 6) Matriz de impacto: nivel de impacto (filas) por calificacion (columnas). Cada celda lleva a sus documentos.
//    Intensidad del color = cantidad de documentos (una sola tonalidad por columna).
export function Matriz({ todos, ver }) {
  const filas = [["Alto", "8 a 10"], ["Moderado", "5 a 7"], ["Bajo", "1 a 4"]];
  const cols = ["Desfavorable", "Para seguimiento", "Favorable"];
  const n = (imp, cal) => todos.filter((x) => x.impacto === imp && x.calificacion === cal).length;
  const tope = Math.max(1, ...filas.flatMap(([imp]) => cols.map((c) => n(imp, c))));
  const lectura = { Desfavorable: "Riesgo", "Para seguimiento": "Vigilar", Favorable: "Oportunidad" };
  return (
    <Tarjeta titulo="Matriz de impacto" nota="Cuántos documentos hay según su impacto y su efecto. Arriba a la izquierda, los riesgos mayores; arriba a la derecha, las mayores oportunidades. Pulsa una celda para verlos." ancho>
      <div className="matriz">
        <div />
        {cols.map((c) => (
          <div key={c} className="mz-col"><i style={{ background: COLOR_CAL[c] }} />{c}<span>{lectura[c]}</span></div>
        ))}
        {filas.map(([imp, rango]) => (
          <div key={imp} style={{ display: "contents" }}>
            <div className="mz-fila">Impacto {imp.toLowerCase()}<span>puntaje {rango}</span></div>
            {cols.map((c) => {
              const v = n(imp, c);
              const a = v ? 0.12 + 0.78 * (v / tope) : 0;
              const fuerte = a > 0.5;
              return (
                <a key={c} className="mz-celda" href={ver({ impacto: imp, calificacion: c })}
                  title={`${imp} · ${c}: ${v} documentos`}
                  style={{ background: v ? `color-mix(in srgb, ${COLOR_CAL[c]} ${Math.round(a * 100)}%, #ffffff)` : "#f6f5f2", color: fuerte ? "#fff" : TINTA }}>
                  <b>{v}</b>
                  <span>{v === 1 ? "documento" : "documentos"}</span>
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

// 7) Los temas mas importantes del periodo (mayor puntaje)
export function Principales({ todos, nombre, enlace }) {
  const top = [...todos].filter((x) => x.puntaje).sort((a, b) => b.puntaje - a.puntaje || (a.calificacion === "Desfavorable" ? -1 : 1)).slice(0, 5);
  if (!top.length) return null;
  return (
    <Tarjeta titulo="Los 5 temas más importantes del periodo" nota="Los documentos con mayor puntaje de impacto." ancho>
      <ol className="principales">
        {top.map((x) => (
          <li key={`${x.origen}-${x.analisis_id}`}>
            <span className="pr-puntaje">{x.puntaje}<small>/10</small></span>
            <div>
              <div className="pr-titulo">
                <a href={enlace(x)} target="_blank" rel="noopener noreferrer">{nombre(x)}</a>
                <span className="pr-tipo">{x.origen === "N" ? "Norma legal" : "Proyecto de ley"} · {x.sector}</span>
                <span className="pr-cal"><i style={{ background: COLOR_CAL[x.calificacion] }} />{x.calificacion}</span>
              </div>
              <p>{x.resumen}</p>
            </div>
          </li>
        ))}
      </ol>
    </Tarjeta>
  );
}
