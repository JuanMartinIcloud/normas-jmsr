import nodemailer from "nodemailer";
import { consultar } from "./db";

// Envio del informe por correo. Usa una cuenta de correo (por ejemplo Gmail con "contraseña de aplicación")
// configurada en Vercel con las variables CORREO_USUARIO y CORREO_CLAVE (y opcionalmente CORREO_SERVIDOR).

export function correoConfigurado() {
  return Boolean((process.env.CORREO_USUARIO || "").trim() && (process.env.CORREO_CLAVE || "").trim());
}

export async function leerDestinatarios() {
  const [f] = await consultar(`SELECT valor FROM configuracion WHERE clave = 'destinatarios'`);
  try {
    const d = JSON.parse(f?.valor || "{}");
    return { general: d.general || [], comites: d.comites || {} };
  } catch {
    return { general: [], comites: {} };
  }
}

export async function guardarDestinatarios(d) {
  await consultar(
    `INSERT INTO configuracion (clave, valor) VALUES ('destinatarios', $1)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = now()`,
    [JSON.stringify(d)]
  );
}

export function listaCorreos(texto) {
  return String(texto || "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}

export async function enviarCorreo({ para, asunto, html }) {
  const usuario = process.env.CORREO_USUARIO.trim();
  const t = nodemailer.createTransport({
    host: (process.env.CORREO_SERVIDOR || "smtp.gmail.com").trim(),
    port: 465,
    secure: true,
    auth: { user: usuario, pass: process.env.CORREO_CLAVE.trim().replace(/\s+/g, "") },
  });
  await t.sendMail({ from: `Monitoreo empresarial <${usuario}>`, to: para.join(", "), subject: asunto, html });
}
