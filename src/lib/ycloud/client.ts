import "server-only";

/**
 * Cliente de la API de YCloud.
 *
 * Contrato en `SPIKE-ycloud.md` §1. Solo lo que necesita F1: enviar un texto.
 * Plantillas, adjuntos y estado de entrega llegan en fases posteriores.
 */

const BASE = "https://api.ycloud.com/v2";

/**
 * Límite de WhatsApp para el cuerpo de un mensaje de texto.
 *
 * Si se pasa, Meta rechaza el envío entero: el cliente se queda sin respuesta y
 * en la bandeja aparece un fallo. Preferimos recortar y avisar antes que perder
 * el mensaje, así que quien llama recibe `recortado: true` y puede registrarlo.
 */
export const LIMITE_TEXTO = 4096;

/** Si YCloud no contesta en este tiempo, se corta. */
const TIMEOUT_MS = 10_000;

export type RespuestaEnvio = {
  /**
   * Identificador del mensaje en Meta. Va a `messages.wamid`.
   *
   * **Puede venir `null`**, y no es un error. YCloud acepta el mensaje y lo
   * encola; el identificador de Meta llega después, por el evento
   * `whatsapp.message.updated`. Verificado en vivo el 31/07/2026: un envío
   * correcto respondió `200` sin `wamid`.
   *
   * El `SPIKE-ycloud.md` decía que siempre venía. No es así.
   */
  wamid: string | null;
  /** Identificador interno de YCloud. Este sí viene siempre. */
  id: string | null;
  status: string | null;
  /** `true` si el texto hubo que recortarlo para que Meta lo aceptara. */
  recortado: boolean;
};

export class ErrorYCloud extends Error {
  constructor(
    message: string,
    readonly estado: number | null,
  ) {
    super(message);
    this.name = "ErrorYCloud";
  }
}

export async function enviarTexto({
  apiKey,
  desde,
  hacia,
  texto,
}: {
  /** Clave de la cuenta de YCloud de *este* cliente, sacada de Vault. */
  apiKey: string;
  /** Número del canal, en E.164. */
  desde: string;
  /** Número del contacto, en E.164. */
  hacia: string;
  texto: string;
}): Promise<RespuestaEnvio> {
  const limpio = texto.trim();
  if (!limpio) throw new ErrorYCloud("No se envían mensajes vacíos.", null);

  const recortado = limpio.length > LIMITE_TEXTO;
  const cuerpo = recortado ? `${limpio.slice(0, LIMITE_TEXTO - 1)}…` : limpio;

  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}/whatsapp/messages`, {
      method: "POST",
      headers: {
        // Ojo: YCloud usa `X-API-Key`, no `Authorization: Bearer`.
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "text",
        from: desde,
        to: hacia,
        text: { body: cuerpo },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (causa) {
    // Sin timeout, una petición colgada dejaría el `after()` del webhook vivo
    // hasta que la plataforma lo mate, y el cliente sin respuesta ni error.
    const motivo = causa instanceof Error ? causa.message : String(causa);
    throw new ErrorYCloud(`No se pudo contactar con YCloud: ${motivo}`, null);
  }

  if (!respuesta.ok) {
    /*
     * El cuerpo del error de YCloud puede repetir datos de la petición. Se
     * recorta a 300 caracteres y **nunca** se incluye la clave: este mensaje
     * acaba en los logs, y un log con la clave de un cliente dentro es una fuga.
     */
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
    throw new ErrorYCloud(
      `YCloud respondió ${respuesta.status}: ${detalle}`,
      respuesta.status,
    );
  }

  const datos = (await respuesta.json().catch(() => null)) as {
    id?: string;
    wamid?: string;
    status?: string;
  } | null;

  /*
   * No se exige `wamid`: YCloud acepta el mensaje y devuelve el suyo (`id`),
   * mientras que el de Meta llega más tarde por `whatsapp.message.updated`.
   *
   * La primera versión tiraba un error aquí, y eso convertía un envío correcto
   * en un fallo: el mensaje llegaba al cliente pero no quedaba registrado.
   *
   * La idempotencia del saliente no depende de esto: el `wamid` solo participa
   * en el índice único, que además ignora los nulos. Lo que evita responder dos
   * veces es la deduplicación del evento entrante en `processed_events`, que
   * ocurre antes de llegar aquí.
   */
  return {
    wamid: datos?.wamid ?? null,
    id: datos?.id ?? null,
    status: datos?.status ?? null,
    recortado,
  };
}
