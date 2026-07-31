/**
 * Normalización de números de teléfono a formato E.164.
 *
 * ## Por qué existe
 *
 * `contacts` tiene `unique (workspace_id, wa_phone)`, y ese índice es el que
 * impide que un mismo cliente aparezca tres veces en la bandeja. Pero un índice
 * único compara **texto**: si el mismo teléfono llega escrito de tres formas
 *
 *     +34 662 55 28 51   ·   34662552851   ·   0034662552851
 *
 * el índice ve tres valores distintos, los admite los tres, y el historial de
 * esa persona queda partido en tres conversaciones que no se hablan entre sí.
 *
 * La deduplicación no la hace la base de datos: la hace esta función. El índice
 * solo la hace cumplir.
 *
 * ## Qué es E.164
 *
 * El formato internacional: un `+`, el prefijo de país y el número, sin espacios
 * ni separadores, con un máximo de 15 dígitos. `+34662552851`.
 *
 * ## Por qué sin librería
 *
 * `libphonenumber` pesa cientos de kilobytes y resuelve un problema que aquí no
 * tenemos: validar contra el plan de numeración de 200 países. YCloud entrega
 * los números ya en formato internacional, así que lo que hace falta es limpiar
 * y comprobar la forma, no adivinar el país.
 */

/** España. Se usa solo cuando el número llega sin prefijo de país. */
const PREFIJO_POR_DEFECTO = "34";

/** Los números nacionales españoles tienen nueve dígitos. */
const LARGO_NACIONAL_ES = 9;

/**
 * E.164: un `+`, un primer dígito que no puede ser cero, y de 8 a 15 dígitos
 * en total. El cero inicial está prohibido porque ningún prefijo de país
 * empieza por cero — ahí es donde se cuelan los `0034` mal convertidos.
 */
const FORMA_E164 = /^\+[1-9]\d{7,14}$/;

export function normalizarE164(
  entrada: string | null | undefined,
  { prefijoPais = PREFIJO_POR_DEFECTO }: { prefijoPais?: string } = {},
): string | null {
  if (!entrada) return null;

  // Fuera todo lo que no sea dígito: espacios, guiones, puntos y paréntesis.
  // El `+` se trata aparte porque solo vale al principio.
  const teniaMas = entrada.trim().startsWith("+");
  const digitos = entrada.replace(/\D/g, "");

  if (!digitos) return null;

  let e164: string;

  if (teniaMas) {
    // Ya venía en internacional.
    e164 = `+${digitos}`;
  } else if (digitos.startsWith("00")) {
    // Prefijo internacional a la europea: 00 34 662… → +34662…
    e164 = `+${digitos.slice(2)}`;
  } else if (digitos.length === LARGO_NACIONAL_ES) {
    // Nacional: le falta el país y se le pone el de la tienda.
    e164 = `+${prefijoPais}${digitos}`;
  } else {
    // Lo que manda YCloud: internacional pero sin el `+`.
    e164 = `+${digitos}`;
  }

  return FORMA_E164.test(e164) ? e164 : null;
}

/**
 * Versión que revienta en vez de devolver `null`.
 *
 * Se usa en el webhook: si el número del remitente no se puede normalizar, no
 * hay forma honesta de seguir —no se sabría a qué contacto pertenece el
 * mensaje— y es preferible un error ruidoso que crear un contacto basura.
 */
export function normalizarE164OFallar(
  entrada: string | null | undefined,
  opciones?: { prefijoPais?: string },
): string {
  const numero = normalizarE164(entrada, opciones);
  if (!numero) {
    throw new Error(`Teléfono no normalizable a E.164: ${JSON.stringify(entrada)}`);
  }
  return numero;
}
