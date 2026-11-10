import { NextResponse } from "next/server";

// Puerta de entrada de todo el sitio (se ejecuta antes de cada pagina y de cada consulta a /api).
// 1. Robots, buscadores y programas automaticos: se les niega el acceso (no gastan la base de datos).
// 2. Sin sesion iniciada: las paginas llevan a "Ingresar" y las consultas a /api responden 401.
//    (Aqui solo se revisa que exista una cookie de sesion vigente; la firma y el usuario se verifican
//    despues, en cada pagina y en cada consulta, con lib/auth.js.)
// Excepciones: la pagina de ingreso, el ingreso mismo y la tarea automatica de busquedas guardadas
// (esa usa su propia clave secreta, ver app/api/busquedas/ejecutar).

const TAREA = "/api/busquedas/ejecutar";
const LIBRES = ["/ingresar", "/api/sesion", "/robots.txt"];
const ROBOTS =
  /bot\b|bot\/|crawl|spider|slurp|scrapy|facebookexternalhit|embedly|preview|python-requests|python-urllib|aiohttp|curl\/|wget|go-http-client|java\/|okhttp|libwww|httpclient|headlesschrome|phantomjs/i;
const SESION = /^\d+\.\d+\.[0-9a-f]{64}$/;

function conCabeceras(r) {
  r.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return r;
}

export function middleware(request) {
  const { pathname, search } = request.nextUrl;
  if (pathname === TAREA) return conCabeceras(NextResponse.next());

  const agente = request.headers.get("user-agent") || "";
  if (!agente || ROBOTS.test(agente)) {
    return conCabeceras(new NextResponse("Acceso no permitido.", { status: 403 }));
  }
  if (LIBRES.includes(pathname)) return conCabeceras(NextResponse.next());

  const token = request.cookies.get("sesion")?.value || "";
  const vigente = SESION.test(token) && Number(token.split(".")[1]) > Date.now();
  if (!vigente) {
    if (pathname.startsWith("/api/")) {
      return conCabeceras(NextResponse.json({ error: "Ingresa con tu usuario.", ingresar: true }, { status: 401 }));
    }
    const destino = new URL("/ingresar", request.url);
    destino.searchParams.set("volver", pathname + search);
    return conCabeceras(NextResponse.redirect(destino));
  }
  // La ruta pedida se pasa a las paginas (para volver a ella si hay que ingresar de nuevo)
  const cabeceras = new Headers(request.headers);
  cabeceras.set("x-ruta", pathname + search);
  return conCabeceras(NextResponse.next({ request: { headers: cabeceras } }));
}

export const config = {
  // Todo menos los archivos internos de Next (estilos y codigo de las paginas)
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
