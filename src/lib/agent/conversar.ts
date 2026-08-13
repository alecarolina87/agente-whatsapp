import "server-only";

import type { Mensaje, RespuestaModelo } from "@/lib/openrouter/client";

import {
  MAX_VUELTAS,
  describirParaElModelo,
  ejecutar,
  type HerramientaActiva,
} from "./herramientas";
import { completarConRespaldo, type ModelosElegidos } from "./modelos";

/**
 * Una respuesta del agente, usando herramientas si hacen falta.
 *
 * ## Por qué esto es un bucle y no una llamada
 *
 * Con herramientas, el modelo puede contestar «antes de responder, dame el
 * enlace de reservas». Eso no es la respuesta: es una petición. Hay que
 * ejecutarla, devolverle el resultado y **volver a llamarlo** para que ahora sí
 * escriba. De ahí el bucle.
 *
 * ## Los dos frenos, y por qué existen los dos
 *
 * **`MAX_VUELTAS`** corta la conversación con el modelo. Cada vuelta es una
 * llamada de pago, y un modelo confundido puede pedir la misma herramienta
 * indefinidamente sin llegar a escribir nada.
 *
 * **La suma de costes** es el que casi se me escapa: el tope de gasto mensual
 * lee lo que se guarda en `messages.cost`. Si ahí solo fuera la última llamada,
 * una respuesta que costó tres se apuntaría como una — y el tope, que existe
 * justo para que un día raro no se lleve el margen, contaría de menos
 * exactamente los días raros.
 */

export type ResultadoConversacion = {
  respuesta: RespuestaModelo;
  /** `null` si contestó el modelo principal a la primera. */
  falloDelPrincipal: string | null;
  /** Qué capacidades se usaron. Para dejarlo registrado. */
  herramientasUsadas: string[];
  /** `true` si se agotaron las vueltas sin que el modelo escribiera. */
  seAgotaronLasVueltas: boolean;
};

export async function conversar({
  apiKey,
  modelos,
  mensajes,
  herramientas,
}: {
  apiKey: string;
  modelos: ModelosElegidos;
  mensajes: Mensaje[];
  herramientas: HerramientaActiva[];
}): Promise<ResultadoConversacion> {
  const definiciones = describirParaElModelo(herramientas);
  const hilo = [...mensajes];

  const usadas: string[] = [];
  let falloDelPrincipal: string | null = null;

  // Se acumulan por separado del último `RespuestaModelo` para no perder lo
  // que costaron las vueltas intermedias.
  let entrada = 0;
  let salida = 0;
  let coste = 0;
  let costeConocido = false;

  let ultima: RespuestaModelo | null = null;

  for (let vuelta = 0; vuelta <= MAX_VUELTAS; vuelta += 1) {
    const intento = await completarConRespaldo({
      apiKey,
      modelos,
      mensajes: hilo,
      // En la última vuelta se dejan de ofrecer: si el modelo pudiera pedir
      // otra, la petición se quedaría sin respuesta y él sin escribir nada.
      herramientas:
        vuelta < MAX_VUELTAS && definiciones.length ? definiciones : undefined,
    });

    ultima = intento.respuesta;
    falloDelPrincipal = falloDelPrincipal ?? intento.falloDelPrincipal;

    entrada += intento.respuesta.uso.entrada;
    salida += intento.respuesta.uso.salida;
    if (typeof intento.respuesta.uso.costeUsd === "number") {
      coste += intento.respuesta.uso.costeUsd;
      costeConocido = true;
    }

    // Sin llamadas, el modelo ya ha escrito: hemos terminado.
    if (intento.respuesta.llamadas.length === 0) break;

    /*
     * El mensaje del asistente se devuelve **tal cual**, con sus `tool_calls`.
     * OpenRouter empareja cada petición con su resultado por identificador, y
     * si no se reenvía la petición original el proveedor rechaza el resultado.
     */
    hilo.push({
      role: "assistant",
      content: intento.respuesta.texto,
      tool_calls: intento.respuesta.llamadas,
    });

    for (const llamada of intento.respuesta.llamadas) {
      const resultado = ejecutar(llamada.function.name, herramientas);
      if (resultado.ok) usadas.push(llamada.function.name);

      hilo.push({
        role: "tool",
        tool_call_id: llamada.id,
        content: resultado.salida,
      });
    }
  }

  if (!ultima) {
    // No puede pasar: el bucle corre al menos una vez. Pero si algún día
    // alguien toca la condición, mejor un error claro que un `null` suelto.
    throw new Error("El bucle de conversación no llegó a llamar al modelo.");
  }

  return {
    respuesta: {
      ...ultima,
      uso: { entrada, salida, costeUsd: costeConocido ? coste : null },
    },
    falloDelPrincipal,
    herramientasUsadas: [...new Set(usadas)],
    seAgotaronLasVueltas:
      ultima.llamadas.length > 0 || ultima.texto.trim().length === 0,
  };
}
