"use client";

// Lista de documentos marcados por el usuario (se guarda en este navegador)
const CLAVE = "normas-peru-seleccion";
const EVENTO = "seleccion-cambio";
export const MAXIMO = 6;

function limpiar(lista) {
  return Array.isArray(lista) ? lista.filter((x) => x && (x.t === "N" || x.t === "P") && x.id) : [];
}

export function leerSeleccion() {
  try {
    return limpiar(JSON.parse(window.localStorage.getItem(CLAVE) || "[]"));
  } catch {
    // sin almacenamiento disponible: se usa la copia en memoria de esta pagina
    return limpiar(window.__seleccion || []);
  }
}

export function guardarSeleccion(lista) {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    // navegador sin almacenamiento: la seleccion dura solo mientras la pagina este abierta
  }
  window.__seleccion = lista;
  window.dispatchEvent(new Event(EVENTO));
}

export function seleccionActual() {
  if (typeof window === "undefined") return [];
  return leerSeleccion();
}

export function alCambiar(fn) {
  window.addEventListener(EVENTO, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENTO, fn);
    window.removeEventListener("storage", fn);
  };
}
