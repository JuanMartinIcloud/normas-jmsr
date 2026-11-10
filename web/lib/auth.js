import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { volverSeguro } from "./volver";
import { consultar } from "./db";
import { Aviso } from "./errores";

// Acceso con usuario y contraseña (todo el sitio lo exige).
// - Las contraseñas se guardan cifradas (scrypt con sal), nunca en texto plano.
// - La sesion es una cookie firmada con una clave secreta que se genera sola y se guarda en la base.

const scrypt = promisify(_scrypt);
const COOKIE = "sesion";
const DURACION_DIAS = 7;

export async function cifrarClave(clave) {
  const sal = randomBytes(16);
  const hash = await scrypt(String(clave), sal, 64);
  return `scrypt$${sal.toString("hex")}$${hash.toString("hex")}`;
}

async function claveCorrecta(clave, guardado) {
  const [, salHex, hashHex] = String(guardado || "").split("$");
  if (!salHex || !hashHex) return false;
  const hash = await scrypt(String(clave), Buffer.from(salHex, "hex"), 64);
  const esperado = Buffer.from(hashHex, "hex");
  return esperado.length === hash.length && timingSafeEqual(esperado, hash);
}

let secretoCache = null;
async function secreto() {
  if (secretoCache) return secretoCache;
  const filas = await consultar(`SELECT valor FROM configuracion WHERE clave = 'clave_sesiones'`);
  if (filas.length) return (secretoCache = filas[0].valor);
  const nuevo = randomBytes(32).toString("hex");
  await consultar(
    `INSERT INTO configuracion (clave, valor) VALUES ('clave_sesiones', $1) ON CONFLICT (clave) DO NOTHING`,
    [nuevo]
  );
  const [f] = await consultar(`SELECT valor FROM configuracion WHERE clave = 'clave_sesiones'`);
  return (secretoCache = f.valor);
}

function firmar(datos, clave) {
  return createHmac("sha256", clave).update(datos).digest("hex");
}

// Intentos fallidos de ingreso (limite: MAX_FALLOS en VENTANA_MIN minutos, por conexion y por usuario)
const MAX_FALLOS = 10;
const VENTANA_MIN = 15;
let tablaIntentos = false;
async function asegurarIntentos() {
  if (tablaIntentos) return;
  await consultar(`CREATE TABLE IF NOT EXISTS intentos_ingreso (
    clave  TEXT PRIMARY KEY,
    fallos INT NOT NULL DEFAULT 0,
    desde  TIMESTAMPTZ NOT NULL DEFAULT now())`);
  tablaIntentos = true;
}

export async function bloqueado(claves) {
  await asegurarIntentos();
  const f = await consultar(
    `SELECT 1 FROM intentos_ingreso
     WHERE clave = ANY($1::text[]) AND fallos >= $2 AND desde > now() - make_interval(mins => $3::int) LIMIT 1`,
    [claves, MAX_FALLOS, VENTANA_MIN]
  );
  return f.length > 0;
}

export async function anotarFallo(claves) {
  await asegurarIntentos();
  await consultar(
    `INSERT INTO intentos_ingreso (clave, fallos, desde) SELECT unnest($1::text[]), 1, now()
     ON CONFLICT (clave) DO UPDATE SET
       fallos = CASE WHEN intentos_ingreso.desde > now() - make_interval(mins => $2::int) THEN intentos_ingreso.fallos + 1 ELSE 1 END,
       desde  = CASE WHEN intentos_ingreso.desde > now() - make_interval(mins => $2::int) THEN intentos_ingreso.desde ELSE now() END`,
    [claves, VENTANA_MIN]
  );
}

// Tras un ingreso correcto: se borran sus intentos fallidos y los de hace mas de un dia
export async function limpiarFallos(claves) {
  await asegurarIntentos();
  await consultar(`DELETE FROM intentos_ingreso WHERE clave = ANY($1::text[]) OR desde < now() - interval '1 day'`, [claves]);
}

// Devuelve el usuario si la contraseña es correcta
export async function verificarUsuario(usuario, clave) {
  const filas = await consultar(
    `SELECT id, usuario, nombre, rol, clave_hash FROM usuarios WHERE lower(usuario) = lower($1) AND activo`,
    [String(usuario || "").trim()]
  );
  if (!filas.length || !(await claveCorrecta(clave, filas[0].clave_hash))) return null;
  const { clave_hash, ...u } = filas[0];
  return u;
}

export async function crearUsuario({ usuario, nombre, clave, rol = "editor" }) {
  const u = String(usuario || "").trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,60}$/.test(u)) throw new Aviso("El usuario debe tener de 3 a 60 letras, números, punto, guion o @.");
  if (String(clave || "").length < 8) throw new Aviso("La contraseña debe tener al menos 8 caracteres.");
  const hash = await cifrarClave(clave);
  await consultar(
    `INSERT INTO usuarios (usuario, nombre, clave_hash, rol) VALUES ($1, $2, $3, $4)`,
    [u, String(nombre || "").trim() || u, hash, rol === "admin" ? "admin" : "editor"]
  );
}

// Crea la cookie de sesion (en rutas de API o acciones del servidor)
// La firma usa la clave secreta del sistema y la contraseña cifrada del usuario: si el administrador le
// cambia la contraseña (o la desactiva), sus sesiones abiertas dejan de valer de inmediato.
export async function iniciarSesion(u) {
  const exp = Date.now() + DURACION_DIAS * 86400000;
  const datos = `${u.id}.${exp}`;
  const [f] = await consultar(`SELECT clave_hash FROM usuarios WHERE id = $1`, [Number(u.id)]);
  const token = `${datos}.${firmar(datos, `${await secreto()}|${f.clave_hash}`)}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DURACION_DIAS * 86400,
  });
}

export async function cerrarSesion() {
  (await cookies()).set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}

// Usuario de la sesion actual, o null (se consulta una sola vez por pagina, aunque varias partes lo pidan)
export const usuarioActual = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value || "";
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [id, exp, firma] = partes;
  if (!/^\d+$/.test(id) || Number(exp) < Date.now()) return null;
  if (!/^[0-9a-f]{64}$/.test(firma)) return null;
  const filas = await consultar(`SELECT id, usuario, nombre, rol, clave_hash FROM usuarios WHERE id = $1 AND activo`, [Number(id)]);
  if (!filas.length) return null;
  const { clave_hash, ...u } = filas[0];
  const esperada = firmar(`${id}.${exp}`, `${await secreto()}|${clave_hash}`);
  if (!timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return null;
  return u;
});

// Exige sesion iniciada en una pagina: sin usuario valido lleva a "Ingresar" ANTES de cualquier consulta.
// (Cada pagina la llama en su primera linea: en Next las paginas se arman al mismo tiempo que su
// "layout", asi que la revision del layout sola no impediria que la pagina consulte la base.)
export async function exigirUsuario() {
  const u = await usuarioActual();
  if (!u) redirect(`/ingresar?volver=${encodeURIComponent(volverSeguro((await headers()).get("x-ruta")))}`);
  return u;
}
