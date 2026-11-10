import { createHash } from "node:crypto";
import { consultar } from "./db";

// Guarda cada respuesta de la IA para no volver a gastar cupo si se repite la misma consulta
let tablaLista = false;

async function asegurarTabla() {
  if (tablaLista) return;
  await consultar(`CREATE TABLE IF NOT EXISTS consultas_ia (
    id         BIGSERIAL PRIMARY KEY,
    clave      TEXT UNIQUE NOT NULL,
    tipo       TEXT NOT NULL,
    entrada    JSONB,
    resultado  JSONB NOT NULL,
    modelo     TEXT,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  tablaLista = true;
}

export function claveDe(tipo, datos) {
  return createHash("sha256").update(`${tipo}|${JSON.stringify(datos)}`).digest("hex");
}

export async function buscarGuardada(clave) {
  await asegurarTabla();
  const filas = await consultar(
    `SELECT resultado, modelo, creado_en::text AS creado_en FROM consultas_ia WHERE clave = $1`,
    [clave]
  );
  return filas[0] || null;
}

export async function guardarConsulta(clave, tipo, entrada, resultado, modelo) {
  await asegurarTabla();
  await consultar(
    `INSERT INTO consultas_ia (clave, tipo, entrada, resultado, modelo)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (clave) DO UPDATE SET resultado = EXCLUDED.resultado, modelo = EXCLUDED.modelo, creado_en = now()`,
    [clave, tipo, JSON.stringify(entrada), JSON.stringify(resultado), modelo]
  );
}
