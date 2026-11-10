import { exigirUsuario } from "../../../../lib/auth";
import { consultar } from "../../../../lib/db";
import { mensajeError } from "../../../../lib/errores";

export const metadata = { title: "Control de calidad · Monitoreo empresarial" };

const COLOR = { OK: "#2d6e50", FALLA: "#9b2c4b", INFO: "#7a6e8c" };
const TEXTO = { OK: "✔ Correcto", FALLA: "✘ Falla", INFO: "ℹ Dato" };

// Resultado del control de calidad que corre cada mañana (src/control.py)
export default async function Control() {
  await exigirUsuario();
  let filas = [];
  let error = "";
  try {
    filas = await consultar(
      `SELECT fecha::text AS fecha, ok, resultado, to_char(creado_en AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora
       FROM control_calidad ORDER BY fecha DESC LIMIT 14`
    );
  } catch (e) {
    error = /control_calidad/.test(String(e.message)) ? "" : mensajeError(e);
  }
  return (
    <>
      <h1>Control de calidad</h1>
      <p className="sub">
        Cada mañana el sistema comprueba con datos que todo esté completo y correcto: que cada tarea corrió a su hora, que
        las normas coinciden con El Peruano y los proyectos con el Congreso, que cada ley tiene su enlace, que el monitoreo
        del mes está al día, que cada análisis está completo, el texto completo, el resumen diario y el consumo.
      </p>
      {error && <div className="error"><strong>No se pudo leer.</strong><p>{error}</p></div>}
      {!error && filas.length === 0 && <p className="vacio">Todavía no hay controles. El primero se hace mañana a las 7:00 a. m.</p>}
      {filas.map((f, i) => (
        <details key={f.fecha} className="grafico otros" open={i === 0}>
          <summary>
            <strong style={{ color: f.ok ? COLOR.OK : COLOR.FALLA }}>{f.ok ? "✔ Todo correcto" : "✘ Con fallas"}</strong> · {f.fecha} ({f.hora})
          </summary>
          <table className="tabla-mon">
            <tbody>
              {(f.resultado || []).map((r, k) => (
                <tr key={k}>
                  <td style={{ color: COLOR[r.estado], whiteSpace: "nowrap" }}>{TEXTO[r.estado] || r.estado}</td>
                  <td>{r.tema}</td>
                  <td>{r.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </>
  );
}
