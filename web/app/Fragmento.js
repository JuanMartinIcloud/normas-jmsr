// Muestra el pasaje del texto completo donde aparece lo buscado ([[palabra]] se resalta)
export default function Fragmento({ texto }) {
  if (!texto) return null;
  const partes = String(texto).split(/(\[\[.*?\]\])/g);
  return (
    <p className="fragmento">
      <span className="fragmento-etq">En el texto:</span>{" "}
      {partes.map((p, i) =>
        p.startsWith("[[") && p.endsWith("]]") ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>
      )}
    </p>
  );
}
