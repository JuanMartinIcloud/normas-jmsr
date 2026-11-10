// Mensajes de error que se muestran al usuario.
// Solo se muestran los avisos escritos por el sistema (clase Aviso y los errores de la IA, que la extienden).
// Cualquier otro error (de la base de datos, de la red, etc.) se anota en el registro del servidor y al
// usuario se le muestra un mensaje general: asi no se revelan detalles internos (servidores, tablas, consultas).
export class Aviso extends Error {}

export function mensajeError(e) {
  if (e instanceof Aviso) return e.message;
  console.error(e);
  return "Ocurrió un error en el servidor. Intenta de nuevo en unos minutos.";
}
