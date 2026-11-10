// Ningun buscador debe recorrer ni indexar el sitio (es de uso interno)
export default function robots() {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
