"use client";

import { useEffect } from "react";

/**
 * Pone en el título de la pestaña cuántas conversaciones te esperan.
 *
 * Es el aviso que encaja con cómo trabaja Ale: no está delante del ordenador
 * cuando llegan los mensajes —está con una clienta—, así que un sonido o una
 * notificación emergente saltarían en una habitación vacía. Lo que sí hace es
 * volver a la pestaña al terminar. Y ahí el título ya se lo dice, sin tener que
 * entrar a mirar.
 *
 * Por eso tampoco se pide permiso de notificaciones del navegador: sería una
 * ventana molesta a cambio de un aviso que casi nunca vería.
 */
export function ContadorPestana({ cuantas, base }: { cuantas: number; base: string }) {
  useEffect(() => {
    document.title = cuantas > 0 ? `(${cuantas}) ${base}` : base;

    /*
     * Al salir se deja el título limpio. Sin esto, navegar a otra pantalla se
     * llevaría el contador puesto y diría que hay gente esperando en un sitio
     * donde no se está mirando eso.
     */
    return () => {
      document.title = base;
    };
  }, [cuantas, base]);

  return null;
}
