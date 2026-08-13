/**
 * A qué horas se le puede escribir a una clienta.
 *
 * ## Por qué esto existe
 *
 * Un recordatorio de «llevas 24 h sin contestar» no elige la hora: la elige el
 * momento en que la clienta escribió el día anterior. Si preguntó por el precio
 * de las cejas a las once y media de la noche, el barrido del día siguiente le
 * mandaría el recordatorio a las once y media de la noche.
 *
 * Eso no es un fallo técnico —el mensaje sale perfecto— y por eso no lo iba a
 * pillar ningún test. Es un negocio de estética escribiéndole a una clienta de
 * madrugada, y lo que se pierde ahí no es el mensaje: es la clienta, que
 * bloquea el número.
 *
 * ## Qué pasa fuera de esa franja
 *
 * **No se cancela, se pospone.** El barrido vuelve a pasar cada diez minutos y
 * el silencio sigue ahí, así que el recordatorio sale a las nueve de la mañana.
 * Descartarlo perdería la conversación por haber caído en mala hora.
 *
 * ## La deuda conocida
 *
 * La zona horaria está fija en Europe/Madrid, igual que en `mensajes_de_hoy()`.
 * Vale mientras todos los clientes estén en España. El día que haya uno fuera,
 * esto y aquello se arreglan juntos con una columna en `workspaces`.
 */

export const ZONA_POR_DEFECTO = "Europe/Madrid";

/** Primera hora a la que sale un mensaje automático. */
export const HORA_APERTURA = 9;

/** A partir de esta hora ya no sale ninguno. 21 = el último a las 20:59. */
export const HORA_CIERRE = 21;

/**
 * La hora local en esa zona, de 0 a 23.
 *
 * Se saca con `Intl` y no con `getHours()` a propósito: el servidor corre en
 * UTC, así que `getHours()` daría la hora de Londres — y en verano eso son dos
 * horas de diferencia con Madrid, suficiente para mandar un mensaje a las siete
 * de la mañana creyendo que son las nueve.
 */
export function horaLocal(
  fecha: Date,
  zona: string = ZONA_POR_DEFECTO,
): number {
  const formateada = new Intl.DateTimeFormat("es-ES", {
    timeZone: zona,
    hour: "numeric",
    hour12: false,
  }).format(fecha);

  // En es-ES, la medianoche sale como «24» y no como «0».
  return Number(formateada) % 24;
}

/** ¿Se le puede escribir a alguien ahora mismo? */
export function esHoraDecente(
  fecha: Date,
  zona: string = ZONA_POR_DEFECTO,
): boolean {
  const hora = horaLocal(fecha, zona);
  return hora >= HORA_APERTURA && hora < HORA_CIERRE;
}
