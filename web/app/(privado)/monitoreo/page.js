import AvisoMes from "./AvisoMes";
import { exigirUsuario } from "../../../lib/auth";
import { leerFiltrosMonitoreo, normasAnalizadas, proyectosAnalizados, cifrasPeriodo, estadoMes, finDeMes, nombreMes } from "../../../lib/monitoreo";
import { mensajeError } from "../../../lib/errores";
import { urlProyecto } from "../../../lib/resumenes";
import { estadoProyecto } from "../../../lib/leyes";
import { leerPeriodo } from "../../../lib/periodo";
import { contar } from "./Graficos";
import { Balance, Evolucion, Puntajes, Sectores, Comites, Matriz, Principales } from "./Tablero";
import BotonEjecutivo from "./BotonEjecutivo";

export const metadata = { title: "Resumen ejecutivo · Monitoreo empresarial" };

const CAMARA_NOMBRE = { D: "Cámara de Diputados", S: "Senado", C: "Congreso (unicameral)" };
// Camara del proyecto y quien lo propuso (sin repetir la camara cuando la propuesta es de sus propios congresistas)
const simple = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function origenProyecto(x) {
  const camara = CAMARA_NOMBRE[x.camara] || x.camara || "";
  const prop = x.proponente || "";
  const propio = !prop || simple(prop) === simple(camara) || /^(congreso|camara de diputados|senado)/.test(simple(prop));
  return propio ? `${camara} · Propuesto por congresistas` : `${camara} · Propuesto por: ${prop}`;
}

const CALS = ["Favorable", "Desfavorable", "Para seguimiento"];

export default async function ResumenEjecutivo({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  await exigirUsuario();
  const sp = searchParams || {};
  const per = leerPeriodo(sp);
  const f = leerFiltrosMonitoreo({});
  let normas = [];
  let proyectos = [];
  let error = "";
  // Mes anterior, para comparar las cifras (solo cuando se ve un mes)
  const [a, m] = per.mes.split("-").map(Number);
  const mesAnt = `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  let previos = null;
  try {
    const [n0, p0, cAnt, eAnt] = await Promise.all([
      normasAnalizadas(f, per.desde, per.hasta),
      proyectosAnalizados(f, per.desde, per.hasta),
      per.tipo === "mes" ? cifrasPeriodo(`${mesAnt}-01`, finDeMes(mesAnt)) : Promise.resolve(null),
      per.tipo === "mes" ? estadoMes(mesAnt) : Promise.resolve(null),
    ]);
    normas = n0;
    proyectos = p0;
    // Solo se compara si la IA ya reviso todo el mes anterior (si no, la comparacion engañaria)
    if (cAnt && eAnt && !(eAnt.faltan_normas + eAnt.faltan_proyectos)) previos = cAnt;
  } catch (e) {
    error = mensajeError(e);
  }
  const todos = [...normas.map((n) => ({ ...n, origen: "N" })), ...proyectos.map((p) => ({ ...p, origen: "P" }))];
  const cuenta = (campo, valor) => todos.filter((x) => x[campo] === valor).length;
  const sectores = contar(todos, "sector");
  const nombre = (x) => (x.origen === "N" ? [x.tipo, x.numero].filter(Boolean).join(" N° ") : `Proposición ${x.numero}`);
  // Todos los de impacto alto (normas y proyectos), del mayor al menor puntaje
  const destacados = todos
    .filter((x) => x.impacto === "Alto")
    .sort((a, b) => (b.puntaje || 0) - (a.puntaje || 0));
  // Al pulsar una cifra o una barra se abre "Impacto" con ese filtro (mismo periodo)
  const periodo = per.tipo === "mes" ? `mes=${per.mes}` : `fecha=${per.fecha}`;
  const ver = (filtro) => `/monitoreo/impacto?${periodo}&${new URLSearchParams(filtro).toString()}#detalle`;
  const total = todos.length;
  const pct = (n) => (total ? `${Math.round((n / total) * 100)} % del total` : "");
  // Diferencia frente al mes anterior (flecha y cifra, en texto neutro)
  const nomAnt = nombreMes(mesAnt).split(" ")[0];
  const delta = (actual, anterior) => {
    if (!previos) return null;
    const d = actual - anterior;
    return <div className="d">{d === 0 ? `igual que ${nomAnt}` : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} frente a ${nomAnt} (${anterior})`}</div>;
  };
  const ant = (campo, valor) => (previos ? previos.cuenta(campo, valor) : 0);
  const enlaceDoc = (x) => (x.origen === "N" ? x.url_detalle : urlProyecto(x));
  // De donde viene: normas = entidad que la emitio; proyectos = camara y quien lo propuso
  const origenDe = (x) => (x.origen === "N" ? x.entidad || "" : origenProyecto(x));
  const estadoDe = (x) => (x.origen === "N" ? `Publicada en El Peruano (${x.fecha})` : estadoProyecto(x));

  return (
    <>
      <h1>Resumen ejecutivo · {per.nombre}</h1>
      <AvisoMes mes={per.desde.slice(0, 7)} />
      <form className="filtros" method="get" action="/monitoreo">
        <label>
          Mes
          <input type="month" name="mes" defaultValue={per.tipo === "mes" ? per.mes : ""} />
        </label>
        <label>
          o un día
          <input type="date" name="fecha" defaultValue={per.fecha} />
        </label>
        <div className="acciones">
          <button className="boton" type="submit">Ver</button>
        </div>
      </form>
      {error && <div className="error"><strong>No se pudo leer el reporte.</strong><p>{error}</p></div>}

      <div className="kpis">
        <a className="kpi" href={per.tipo === "mes" ? `/monitoreo/normas?mes=${per.mes}` : ver({})}><div className="n">{normas.length}</div><div className="t">Normas legales con impacto</div>{delta(normas.length, previos?.normas)}</a>
        <a className="kpi" href={ver({})}><div className="n">{proyectos.length}</div><div className="t">Proyectos de ley con impacto</div>{delta(proyectos.length, previos?.proyectos)}</a>
        <a className="kpi" href={ver({ calificacion: "Favorable" })}><div className="n" style={{ color: "#2f8f4e" }}>{cuenta("calificacion", "Favorable")}</div><div className="t">Favorables</div><div className="p">{pct(cuenta("calificacion", "Favorable"))}</div>{delta(cuenta("calificacion", "Favorable"), ant("calificacion", "Favorable"))}</a>
        <a className="kpi" href={ver({ calificacion: "Desfavorable" })}><div className="n" style={{ color: "#c0392b" }}>{cuenta("calificacion", "Desfavorable")}</div><div className="t">Desfavorables</div><div className="p">{pct(cuenta("calificacion", "Desfavorable"))}</div>{delta(cuenta("calificacion", "Desfavorable"), ant("calificacion", "Desfavorable"))}</a>
        <a className="kpi" href={ver({ calificacion: "Para seguimiento" })}><div className="n" style={{ color: "#a07800" }}>{cuenta("calificacion", "Para seguimiento")}</div><div className="t">Para seguimiento</div><div className="p">{pct(cuenta("calificacion", "Para seguimiento"))}</div>{delta(cuenta("calificacion", "Para seguimiento"), ant("calificacion", "Para seguimiento"))}</a>
        <a className="kpi" href={ver({ impacto: "Alto" })}><div className="n">{cuenta("impacto", "Alto")}</div><div className="t">De impacto alto (8 a 10)</div><div className="p">{pct(cuenta("impacto", "Alto"))}</div>{delta(cuenta("impacto", "Alto"), ant("impacto", "Alto"))}</a>
      </div>

      <BotonEjecutivo desde={per.desde} hasta={per.hasta} nombre={per.nombre} cantidad={todos.length} />

      <div className="tablero">
        <Principales todos={todos} nombre={nombre} enlace={enlaceDoc} />
        <Balance todos={todos} ver={ver} />
        <Matriz todos={todos} ver={ver} />
        <Evolucion todos={todos} desde={per.desde} hasta={per.hasta} verDia={(d) => `/monitoreo/impacto?fecha=${d}#detalle`} />
        <Puntajes todos={todos} ver={ver} />
        <Sectores todos={todos} ver={ver} />
        <Comites todos={todos} ver={ver} />
      </div>

      <h2 className="seccion">Cuadro del informe: sector económico por calificación</h2>
      <div className="envoltura-tabla">
        <table className="tabla-mon">
          <thead>
            <tr><th>Sector económico</th>{CALS.map((c) => <th key={c} className="num">{c}</th>)}<th className="num">Total</th></tr>
          </thead>
          <tbody>
            {sectores.map((s) => (
              <tr key={s.etiqueta}>
                <td>{s.etiqueta}</td>
                {CALS.map((c) => (
                  <td key={c} className="num">{todos.filter((x) => x.sector === s.etiqueta && x.calificacion === c).length || ""}</td>
                ))}
                <td className="num"><strong>{s.valor}</strong></td>
              </tr>
            ))}
            <tr>
              <td><strong>Total</strong></td>
              {CALS.map((c) => <td key={c} className="num"><strong>{cuenta("calificacion", c)}</strong></td>)}
              <td className="num"><strong>{todos.length}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="seccion">Documentos de impacto alto ({destacados.length}: {destacados.filter((x) => x.origen === "N").length} normas y {destacados.filter((x) => x.origen === "P").length} proyectos de ley)</h2>
      {destacados.length > 0 && (
        <p className="acciones">
          <a className="boton sec" href={`/api/monitoreo/alto-impacto?${periodo}&formato=word`}>Descargar en Word</a>
          <a className="boton sec" href={`/api/monitoreo/alto-impacto?${periodo}&formato=excel`}>Descargar en Excel</a>
        </p>
      )}
      {destacados.length === 0 ? (
        <p className="vacio">No hay documentos de impacto alto en este periodo.</p>
      ) : (
        <div className="envoltura-tabla">
          <table className="tabla-mon">
            <thead><tr><th>Documento</th><th>Tipo</th><th>Emisor u origen</th><th>Estado</th><th className="num">Puntaje</th><th>Sector</th><th>Calificación</th><th>En qué consiste</th><th>Cambios</th></tr></thead>
            <tbody>
              {destacados.map((x) => (
                <tr key={`${x.origen}-${x.analisis_id}`}>
                  <td>{nombre(x)}</td><td>{x.origen === "N" ? "Norma legal" : "Proyecto de ley"}</td>
                  <td>{origenDe(x)}</td><td>{estadoDe(x)}</td>
                  <td className="num">{x.puntaje ? `${x.puntaje}/10` : "—"}</td>
                  <td>{x.sector}</td><td>{x.calificacion}</td><td>{x.resumen}</td><td>{x.cambios}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ia-pendiente">
        Más detalle en <a href={`/monitoreo/impacto?${per.tipo === "mes" ? `mes=${per.mes}` : `fecha=${per.fecha}`}`}>Impacto</a>,{" "}
        <a href={`/monitoreo/normas?mes=${per.mes}`}>Normas legales</a> y <a href="/monitoreo/congreso">Congreso</a>.
      </p>
    </>
  );
}
