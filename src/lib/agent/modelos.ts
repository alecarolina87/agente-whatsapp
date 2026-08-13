import "server-only";

import {
  ErrorOpenRouter,
  completarChat,
  type DefinicionHerramienta,
  type Mensaje,
} from "@/lib/openrouter/client";

import { modeloValido } from "./catalogo";

/**
 * Qué cerebro usa cada negocio, y con cuál sigue si ese falla.
 *
 * ## Las dos cosas que resuelve, que no son la misma
 *
 * **Elegir modelo** es una palanca de negocio: un negocio que solo confirma
 * citas no necesita lo mismo que una clínica que responde dudas de ortodoncia,
 * y hasta ahora pagaban igual porque costaban igual.
 *
 * **El respaldo** es una avería. Si el modelo da error, el agente se calla y la
 * clienta se queda esperando; nadie se entera hasta que llama. Con respaldo,
 * «hoy no contesta» se convierte en «hoy contesta un poco distinto», que no se
 * nota. De las dos, esta es la que de verdad importa.
 *
 * El catálogo vive en `catalogo.ts`, que no es `server-only` porque el
 * desplegable de ajustes también lo necesita.
 */

export type ModelosElegidos = {
  principal: string;
  /** `null` si no hay respaldo, o si sería el mismo que el principal. */
  respaldo: string | null;
};

/**
 * Decide con qué modelos se va a intentar responder.
 *
 * Un modelo guardado que ya no esté en el catálogo **se ignora** y se cae al de
 * la plataforma. Es deliberado: los modelos se retiran, y un negocio apuntando
 * a uno que ya no existe fallaría en cada mensaje. Dejar mudo al agente de un
 * cliente porque cambió el catálogo sería el peor final posible para esto.
 *
 * @returns `null` si ni siquiera hay modelo de plataforma configurado.
 */
export function elegirModelos({
  modelo,
  modeloRespaldo,
  porDefecto = process.env.OPENROUTER_DEFAULT_MODEL,
}: {
  modelo: string | null;
  modeloRespaldo: string | null;
  porDefecto?: string;
}): ModelosElegidos | null {
  const principal = modeloValido(modelo) ? modelo! : (porDefecto ?? null);
  if (!principal) return null;

  const respaldo = modeloValido(modeloRespaldo) ? modeloRespaldo! : null;

  return {
    principal,
    // Reintentar con el mismo modelo es esperar dos veces el mismo fallo.
    respaldo: respaldo && respaldo !== principal ? respaldo : null,
  };
}

export type ResultadoConRespaldo = {
  respuesta: Awaited<ReturnType<typeof completarChat>>;
  /** `null` si contestó el principal; si no, por qué hubo que cambiar. */
  falloDelPrincipal: string | null;
};

/**
 * Pide la respuesta al modelo principal y, si falla, reintenta con el respaldo.
 *
 * ## Qué cuenta como «falla»
 *
 * Cualquier error: el proveedor caído, un tiempo de espera agotado, una
 * respuesta vacía. No se distingue entre unos y otros a propósito, porque desde
 * aquí no hay forma de saber cuál se arregla solo, y para la clienta que espera
 * son todos el mismo: nadie contesta.
 *
 * ## Lo que cuesta reintentar
 *
 * Hasta 25 segundos de más, que es el tiempo de espera del cliente de
 * OpenRouter. Donde esto corre —el motor, ya después de haber respondido `200`
 * a YCloud; y la pantalla de probar— nadie está esperando un acuse, así que se
 * puede pagar esa espera a cambio de contestar. Lo que **no** se hace es
 * encadenar reintentos: un respaldo, y si también falla, se propaga el error.
 */
export async function completarConRespaldo({
  apiKey,
  modelos,
  mensajes,
  herramientas,
}: {
  apiKey: string;
  modelos: ModelosElegidos;
  mensajes: Mensaje[];
  /** Capacidades que el modelo puede pedir usar antes de contestar. */
  herramientas?: DefinicionHerramienta[];
}): Promise<ResultadoConRespaldo> {
  try {
    return {
      respuesta: await completarChat({
        apiKey,
        modelo: modelos.principal,
        mensajes,
        herramientas,
      }),
      falloDelPrincipal: null,
    };
  } catch (causa) {
    if (!modelos.respaldo) throw causa;

    const motivo =
      causa instanceof ErrorOpenRouter || causa instanceof Error
        ? causa.message
        : String(causa);

    /*
     * Si el respaldo también falla, se propaga **su** error y no el del
     * principal: es el último que ocurrió y el que explica por qué la clienta
     * se ha quedado sin respuesta.
     */
    return {
      respuesta: await completarChat({
        apiKey,
        modelo: modelos.respaldo,
        mensajes,
        herramientas,
      }),
      falloDelPrincipal: motivo,
    };
  }
}
