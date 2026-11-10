/** @type {import('next').NextConfig} */
// Cabeceras de seguridad para todas las respuestas del sitio
const SEGURIDAD = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },     // que ningun buscador lo indexe
  { key: "X-Frame-Options", value: "DENY" },                           // que no se pueda incrustar en otra pagina
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },                    // no revela las direcciones internas al salir
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }, // siempre por https
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

module.exports = {
  poweredByHeader: false,
  // El sitio no usa el optimizador de imagenes de Next: se desactiva (asi su direccion no queda expuesta)
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: SEGURIDAD }];
  },
};
