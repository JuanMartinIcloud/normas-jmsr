"use client";

import { useEffect, useState } from "react";

const minutos = (m) => (m <= 1 ? "1 minuto" : `${m} minutos`);

// «Revisar este mes»: pide la revision de un area en un mes, dice cuanto demorara y muestra el avance.
export default function BotonRevisarMes({ area, mes, estimado, pedido: inicial }) {
  const [pedido, setPedido] = useState(inicial || null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!pedido || pedido.estado === "hecho") return undefined;
    const t = setInterval(async () => {
      const r = await fetch(`/api/areas/avance?id=${pedido.id}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!d || d.error) return;
      setPedido(d);
      if (d.estado === "hecho") {
        clearInterval(t);
        setTimeout(() => window.location.reload(), 1500);
      }
    }, 10000);
    return () => clearInterval(t);
  }, [pedido?.id, pedido?.estado]);

  async function pedir() {
    setEnviando(true);
    setError("");
    const r = await fetch("/api/areas/pedir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area, mes }),
    });
    const d = await r.json().catch(() => ({ error: `Error del servidor (HTTP ${r.status})` }));
    setEnviando(false);
    if (!r.ok || d.error) {
      setError(d.error || "No se pudo pedir la revisión.");
      return;
    }
    setPedido({ ...d.pedido, restante: d.pedido.estimado_min, alMomento: d.alMomento });
  }

  if (!pedido) {
    return (
      <span>
        <button className="boton chico" type="button" onClick={pedir} disabled={enviando}>
          {enviando ? "Un momento…" : "Revisar este mes"}
        </button>{" "}
        <span className="ia-aviso">Demorará aproximadamente {minutos(estimado)}.</span>
        {error && <span className="error"> {error}</span>}
      </span>
    );
  }
  const total = pedido.total || 0;
  const hechos = Math.min(pedido.hechos || 0, total);
  const pct = total ? Math.round((hechos / total) * 100) : 0;
  return (
    <div className="avance-pedido">
      {pedido.estado === "hecho" ? (
        <strong>Listo: el mes está revisado. Actualizando el reporte…</strong>
      ) : (
        <>
          <div className="barra-avance" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span>
            {pedido.estado === "pendiente"
              ? pedido.alMomento === false
                ? "Pedido anotado: se revisará en la próxima ejecución automática (esta noche)."
                : "La revisión está por empezar…"
              : `Revisando: ${hechos.toLocaleString("es-PE")} de ${total.toLocaleString("es-PE")} documentos (${pct} %).`}{" "}
            {pedido.restante ? `Faltan aproximadamente ${minutos(pedido.restante)}.` : ""}
          </span>
        </>
      )}
    </div>
  );
}
