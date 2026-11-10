import { COMITES, CALIFICACIONES, IMPACTOS } from "../../../lib/monitoreo";

const PUNTAJES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Filtros comunes a todos los reportes (formulario GET: cada filtro queda en la direccion)
export default function Filtros({ accion, f, sectores = [], tipos = [], periodo = "mes", extra = null }) {
  return (
    <form className="filtros" method="get" action={accion}>
      {periodo === "mes" && (
        <label>
          Mes
          <input type="month" name="mes" defaultValue={f.mes} />
        </label>
      )}
      {periodo === "dia" && (
        <label>
          Día
          <input type="date" name="fecha" defaultValue={f.fecha} />
        </label>
      )}
      <label>
        Calificación
        <select name="calificacion" defaultValue={f.calificacion}>
          <option value="">Todas</option>
          {CALIFICACIONES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>
        Impacto
        <select name="impacto" defaultValue={f.impacto}>
          <option value="">Todos</option>
          {IMPACTOS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>
        Puntaje desde
        <select name="puntaje_min" defaultValue={f.puntajeMin || ""}>
          <option value="">1</option>
          {PUNTAJES.slice(1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>
        Puntaje hasta
        <select name="puntaje_max" defaultValue={f.puntajeMax || ""}>
          <option value="">10</option>
          {PUNTAJES.slice(0, -1).reverse().map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>
        Sector económico
        <select name="sector" defaultValue={f.sector}>
          <option value="">Todos</option>
          {sectores.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>
        Comité
        <select name="comite" defaultValue={f.comite}>
          <option value="">Todos</option>
          {COMITES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      {tipos.length > 0 && (
        <label>
          Tipo de norma
          <select name="tipo_norma" defaultValue={f.tipoNorma}>
            <option value="">Todos</option>
            {tipos.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      )}
      {tipos.length > 0 && (
        <label>
          Entidad
          <input name="entidad" defaultValue={f.entidad} placeholder="Ej.: SUNAT, MINEM" />
        </label>
      )}
      <label className="ancho">
        Palabras (en el resumen, comentario o sumilla)
        <input type="search" name="texto" defaultValue={f.texto} placeholder="Ej.: impuesto, concesión, laboral" />
      </label>
      <label className="ancho check">
        <input type="checkbox" name="quitados" value="1" defaultChecked={f.quitados} />
        Mostrar también los ítems quitados del reporte
      </label>
      {extra}
      <div className="acciones">
        <button className="boton" type="submit">Filtrar</button>
        <a className="boton sec" href={accion}>Limpiar</a>
      </div>
    </form>
  );
}
