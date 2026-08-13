import "server-only";

import { scoped } from "@/lib/data/scoped";
import type { DefinicionHerramienta } from "@/lib/openrouter/client";

import { HERRAMIENTAS, buscarHerramienta, estaCompleta } from "./catalogo";

/**
 * Las capacidades del agente: cargarlas, ofrecérselas al modelo y ejecutarlas.
 *
 * ## El freno que hay que entender antes de tocar esto
 *
 * Dar herramientas a un modelo abre un bucle: pide una, se le contesta, y con
 * la respuesta puede pedir otra. Cada vuelta es **una llamada más al modelo**,
 * y por tanto dinero. Un modelo confundido puede pedir la misma herramienta una
 * y otra vez sin llegar a escribir nada.
 *
 * Por eso `MAX_VUELTAS`. No es una optimización: es lo que impide que una
 * conversación rara se coma el presupuesto de un cliente en una tarde.
 */

/**
 * Cuántas veces puede el modelo pedir herramientas antes de tener que
 * contestar. Con dos sobra para el caso real —pedir el enlace y escribir— y
 * deja margen si algún día encadena dos.
 */
export const MAX_VUELTAS = 2;

export type HerramientaActiva = {
  clave: string;
  config: Record<string, string>;
};

type FilaHerramienta = {
  clave: string;
  activa: boolean;
  config: Record<string, unknown> | null;
};

/**
 * Las que este negocio tiene activadas **y configuradas**.
 *
 * Se descarta lo incompleto aquí, no al ejecutar: si una herramienta sin
 * configurar llegara al modelo, la llamaría y recibiría un hueco — y a partir
 * de ahí improvisa. Es mejor que no sepa que existe.
 *
 * Una clave que ya no está en el catálogo también se descarta: los despliegues
 * no pueden dejar el agente de un cliente pidiendo algo que nadie ejecuta.
 */
export async function herramientasDelNegocio(
  negocioId: string,
): Promise<HerramientaActiva[]> {
  const db = scoped(negocioId);

  const { data } = await db
    .from("workspace_tools")
    .select("clave, activa, config")
    .eq("activa", true)
    .overrideTypes<FilaHerramienta[], { merge: false }>();

  return (data ?? []).flatMap((fila) => {
    const herramienta = buscarHerramienta(fila.clave);
    if (!herramienta) return [];

    const config = (fila.config ?? {}) as Record<string, string>;
    if (!estaCompleta(herramienta, config)) return [];

    return [{ clave: fila.clave, config }];
  });
}

/** Las traduce al formato que espera OpenRouter. */
export function describirParaElModelo(
  activas: HerramientaActiva[],
): DefinicionHerramienta[] {
  return activas.flatMap((activa) => {
    const herramienta = buscarHerramienta(activa.clave);
    if (!herramienta) return [];

    return [
      {
        type: "function" as const,
        function: {
          name: herramienta.clave,
          description: herramienta.paraElModelo,
          /*
           * Sin parámetros, y es deliberado. Cuantos más argumentos pueda
           * inventarse el modelo, más formas hay de que llame mal a la
           * herramienta. Estas devuelven datos del negocio, no dependen de lo
           * que diga el contacto.
           */
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
    ];
  });
}

export type ResultadoHerramienta = {
  /** Lo que se le devuelve al modelo. Texto plano, no JSON. */
  salida: string;
  ok: boolean;
};

/**
 * Ejecuta una herramienta.
 *
 * Cuando falla **no lanza**: devuelve un texto que explica al modelo qué pasó.
 * Lanzar cortaría la conversación entera por una capacidad secundaria, y la
 * clienta se quedaría sin respuesta por no poder darle un enlace. Con el texto,
 * el modelo puede seguir y ofrecer pasar a una persona.
 */
export function ejecutar(
  clave: string,
  activas: HerramientaActiva[],
): ResultadoHerramienta {
  const activa = activas.find((a) => a.clave === clave);

  if (!activa) {
    return {
      ok: false,
      salida:
        "Esa capacidad no está disponible en este negocio. No la menciones.",
    };
  }

  switch (clave) {
    case "enlace_de_reservas":
      return {
        ok: true,
        salida: `Enlace de reservas: ${activa.config.enlace}. Dáselo tal cual, sin cambiarlo.`,
      };

    default:
      /*
       * Está en el catálogo pero nadie la implementó. Pasa al añadir una
       * entrada y olvidar el caso — y sin este aviso, el modelo recibiría un
       * hueco y se lo inventaría.
       */
      return {
        ok: false,
        salida: "Esa capacidad todavía no está disponible. No la menciones.",
      };
  }
}

export { HERRAMIENTAS, buscarHerramienta, estaCompleta };
