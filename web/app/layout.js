import "./globals.css";
import Bandeja from "./Bandeja";

// Las paginas se arman en cada visita (dependen de la sesion y de los filtros). Las consultas a la base se
// guardan un tiempo (ver lib/bases.js): una misma consulta no se repite mientras su resultado este vigente.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Normas Legales del Perú",
  description: "Buscador de normas legales publicadas en El Peruano, clasificadas por sector y rubro.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        {/* Tipografias de Jurisbot: Nunito (texto) y Fraunces (titulos) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Nunito:wght@400;600;700&display=swap"
        />
      </head>
      <body>
        {children}
        <Bandeja />
      </body>
    </html>
  );
}
