import "server-only";

/**
 * Cliente de OpenRouter.
 *
 * ## Por qué OpenRouter y no un proveedor directo
 *
 * Da acceso a modelos de varios proveedores con una sola cuenta y una sola
 * factura. Aquí importa porque **el modelo lo paga la agencia**, no el cliente
 * (blueprint §7.4): el cliente paga sus mensajes de WhatsApp en su propia
 * cuenta de YCloud, y la plataforma pone la inteligencia. Una sola clave para
 * todos los workspaces, y por eso vive en el entorno y no en Vault.
 */

const URL_API = "https://openrouter.ai/api/v1/chat/completions";

/** Si el modelo no ha contestado en este tiempo, se corta. */
const TIMEOUT_MS = 25_000;

/**
 * Tope de la respuesta.
 *
 * Son unas 400 palabras, de sobra para un mensaje de WhatsApp y muy por debajo
 * del límite de 4096 caracteres de Meta. Además acota el gasto: sin tope, una
 * conversación rara puede generar una respuesta enorme y cara.
 */
const MAX_TOKENS_RESPUESTA = 600;

export type Mensaje = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /**
   * Lo que el modelo pidió llamar. Solo en mensajes del asistente.
   *
   * Se devuelve tal cual y se vuelve a mandar sin tocar: OpenRouter empareja
   * la petición con su resultado por el identificador, y cualquier retoque
   * rompe el emparejamiento.
   */
  tool_calls?: LlamadaHerramienta[];
  /** Con qué llamada empareja este resultado. Solo en mensajes `tool`. */
  tool_call_id?: string;
};

/** Una herramienta, en el formato que espera OpenRouter. */
export type DefinicionHerramienta = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlamadaHerramienta = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type RespuestaModelo = {
  texto: string;
  modelo: string;
  /**
   * Herramientas que el modelo quiere usar antes de contestar.
   *
   * Cuando viene con contenido, `texto` puede estar vacío **y eso es
   * correcto**: el modelo aún no ha escrito nada porque está esperando el
   * resultado de la herramienta.
   */
  llamadas: LlamadaHerramienta[];
  /** Lo que se guarda en `messages.cost` para poder medir el gasto. */
  uso: {
    entrada: number;
    salida: number;
    /**
     * Lo que ha costado esta llamada, en dólares, según OpenRouter.
     *
     * `null` si no lo devuelve. Se pide expresamente con
     * `usage: { include: true }`, y se guarda el número que da el proveedor en
     * vez de calcularlo con una tabla de precios propia: los precios cambian, y
     * una tabla desactualizada da un tope que no frena nada.
     */
    costeUsd: number | null;
  };
};

export class ErrorOpenRouter extends Error {
  constructor(
    message: string,
    readonly estado: number | null,
  ) {
    super(message);
    this.name = "ErrorOpenRouter";
  }
}

export async function completarChat({
  apiKey,
  modelo,
  mensajes,
  herramientas,
  maxTokens = MAX_TOKENS_RESPUESTA,
}: {
  apiKey: string;
  modelo: string;
  mensajes: Mensaje[];
  /** Si se pasan, el modelo puede pedir usarlas antes de contestar. */
  herramientas?: DefinicionHerramienta[];
  maxTokens?: number;
}): Promise<RespuestaModelo> {
  let respuesta: Response;

  try {
    respuesta = await fetch(URL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelo,
        messages: mensajes,
        max_tokens: maxTokens,
        // Solo se manda el campo si hay algo que ofrecer: una lista vacía hace
        // que algunos proveedores rechacen la petición.
        ...(herramientas?.length ? { tools: herramientas } : {}),
        // Temperatura baja: esto atiende a clientes de un negocio, no escribe
        // poesía. Interesa que sea previsible y no que sorprenda.
        temperature: 0.3,
        /*
         * Aquí van conversaciones de los clientes de nuestros clientes: datos
         * personales de terceros. `data_collection: "deny"` hace que OpenRouter
         * descarte los proveedores que se guardan las peticiones para
         * entrenar. Lo pide la auditoría de seguridad del proyecto (ZDR), y es
         * lo que permite firmar un DPA con un cliente sin mentir.
         */
        provider: { data_collection: "deny" },
        /*
         * Que nos diga lo que ha costado. Sin esto habría que mantener una
         * tabla de precios por modelo, y un tope de gasto calculado con precios
         * viejos no frena nada: deja pasar de largo o corta antes de tiempo.
         */
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    throw new ErrorOpenRouter(
      `No se pudo contactar con OpenRouter: ${motivo}`,
      null,
    );
  }

  if (!respuesta.ok) {
    // Recortado y sin la clave dentro: este mensaje acaba en los logs.
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
    throw new ErrorOpenRouter(
      `OpenRouter respondió ${respuesta.status}: ${detalle}`,
      respuesta.status,
    );
  }

  const datos = (await respuesta.json().catch(() => null)) as {
    model?: string;
    choices?: {
      message?: { content?: string; tool_calls?: LlamadaHerramienta[] };
    }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
    };
  } | null;

  const mensaje = datos?.choices?.[0]?.message;
  const llamadas = mensaje?.tool_calls ?? [];
  const texto = mensaje?.content?.trim();

  /*
   * Una respuesta vacía no se envía. Un WhatsApp en blanco es peor que no
   * contestar: el cliente lo ve y parece que el sistema está roto.
   *
   * Con herramientas hay una excepción legítima: el modelo puede contestar
   * **solo** con la llamada, sin texto, porque todavía no sabe qué decir — está
   * esperando el resultado. Tratarlo como error cortaría la conversación justo
   * cuando el agente iba a ser útil.
   */
  if (!texto && llamadas.length === 0) {
    throw new ErrorOpenRouter(
      "El modelo devolvió una respuesta vacía.",
      respuesta.status,
    );
  }

  return {
    texto: texto ?? "",
    llamadas,
    modelo: datos?.model ?? modelo,
    uso: {
      entrada: datos?.usage?.prompt_tokens ?? 0,
      salida: datos?.usage?.completion_tokens ?? 0,
      costeUsd:
        typeof datos?.usage?.cost === "number" ? datos.usage.cost : null,
    },
  };
}
