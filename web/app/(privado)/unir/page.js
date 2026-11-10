import Unir from "./Unir";

export const metadata = { title: "Unir documentos · Normas Legales del Perú" };

export default async function Pagina({ searchParams: parametros }) {
  const searchParams = (await parametros) || {};
  const accion = searchParams?.accion === "proyecto" ? "proyecto" : "unir";
  return (
    <main className="contenedor">
      <h1>{accion === "proyecto" ? "Proyecto de ley unificado" : "Unir documentos en un texto"}</h1>
      <p className="sub">
        {accion === "proyecto"
          ? "La IA lee el PDF completo de cada proyecto seleccionado y redacta uno solo, tomando lo mejor de cada uno."
          : "La IA lee el texto completo de cada documento seleccionado y los une en un solo texto ordenado."}
      </p>
      <nav className="atajos" aria-label="Secciones">
        <a className="atajo" href="/">Normas legales</a>
        <a className="atajo" href="/buscar">Buscar en todo</a>
        <a className="atajo" href="/proyectos">Proyectos de ley</a>
      </nav>
      <Unir accion={accion} />
    </main>
  );
}
