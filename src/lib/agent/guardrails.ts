/**
 * Reglas que el agente no puede saltarse.
 *
 * Son funciones puras y sin dependencias a propósito: son la parte del sistema
 * donde un fallo cuesta más caro, así que tienen que poder probarse enteras sin
 * base de datos ni red.
 */

/** Horas que Meta concede para responder con texto libre. */
export const VENTANA_HORAS = 24;

/**
 * Tope de mensajes por conversación antes de que el agente se calle.
 *
 * Es una red de seguridad contra bucles y contra un contacto que escriba sin
 * parar: cada respuesta cuesta una llamada al modelo, y sin tope una
 * conversación descontrolada se lleva el presupuesto de un cliente en una
 * tarde. El freno principal es el filtro de ecos; esto es el segundo.
 */
export const MAX_MENSAJES_POR_CONVERSACION = 60;

/**
 * Cuándo caduca la ventana a partir de un mensaje entrante.
 *
 * Cada mensaje del contacto la reabre: es lo que hace que responder a alguien
 * que acaba de escribir esté siempre permitido.
 */
export function calcularCaducidadVentana(desde: Date = new Date()): string {
  return new Date(desde.getTime() + VENTANA_HORAS * 60 * 60 * 1000).toISOString();
}

export type DecisionVentana =
  | { permitido: true }
  | { permitido: false; motivo: MotivoAbstencion };

export type MotivoAbstencion = "ventana_cerrada" | "ventana_desconocida";

/**
 * ¿Se puede enviar texto libre a esta conversación?
 *
 * ## Por qué esto existe y no es opcional
 *
 * Meta solo permite escribir libremente a alguien durante las 24 horas
 * siguientes a su último mensaje. Fuera de esa ventana hay que usar una
 * plantilla aprobada. Saltárselo no da un error bonito: degrada la calidad del
 * número y puede acabar con la cuenta de WhatsApp del cliente bloqueada.
 *
 * Es la regla de negocio más cara del sistema, y por eso se decide aquí, en un
 * sitio, y no repartida por el código del agente.
 *
 * ## Por qué `null` no es "adelante"
 *
 * Una conversación sin `window_expires_at` es una conversación de la que no
 * sabemos si la ventana está abierta. Ante la duda, no se envía: equivocarse
 * callando cuesta un mensaje; equivocarse hablando puede costar el número.
 */
export function puedeEnviarTextoLibre(
  caducidadVentana: string | Date | null | undefined,
  ahora: Date = new Date(),
): DecisionVentana {
  if (!caducidadVentana) {
    return { permitido: false, motivo: "ventana_desconocida" };
  }

  const caduca =
    caducidadVentana instanceof Date ? caducidadVentana : new Date(caducidadVentana);

  if (Number.isNaN(caduca.getTime())) {
    return { permitido: false, motivo: "ventana_desconocida" };
  }

  return caduca.getTime() > ahora.getTime()
    ? { permitido: true }
    : { permitido: false, motivo: "ventana_cerrada" };
}

/** ¿Esta conversación ha dado ya demasiadas vueltas? */
export function superaLimiteDeMensajes(mensajesEnLaConversacion: number): boolean {
  return mensajesEnLaConversacion >= MAX_MENSAJES_POR_CONVERSACION;
}
