#!/usr/bin/env bash
# Ejecuta un comando hasta 3 veces (esperando 2 minutos entre intentos) para que una falla pasajera
# (internet, El Peruano, el Congreso o la base de datos sin responder un momento) no detenga la tarea.
# Si un intento fallo despues de trabajar mas de 20 minutos, no se repite (no seria una falla pasajera
# y repetirlo podria pasar el tiempo maximo de la tarea).
for intento in 1 2 3; do
  inicio=$SECONDS
  "$@" && exit 0
  codigo=$?
  if [ $(( SECONDS - inicio )) -gt 1200 ]; then exit $codigo; fi
  [ $intento -lt 3 ] && { echo "Intento $intento fallo (codigo $codigo); se reintenta en 2 minutos..."; sleep 120; }
done
exit $codigo
