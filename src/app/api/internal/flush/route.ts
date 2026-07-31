import { timingSafeEqual } from "node:crypto";

import { cerrarLote, tomarLotesVencidos } from "@/lib/agent/buffer";
import { responderConversacion } from "@/lib/agent/runtime";

/**
 * Vacía los lotes cuyo silencio ya ha pasado.
 *
 * Lo llama un cron cada pocos segundos. También se puede llamar a mano, que es
 * como se prueba en local sin montar el cron.
 *
 * ## Por qué hace falta un endpoint y no lo hace todo la base de datos
 *
 * Responder implica llamar a un modelo de lenguaje y a la API de WhatsApp.
 * Postgres no hace eso: puede avisar, pero el trabajo es de la aplicación. El
 * cron dispara, esto ejecuta.
 *
 * ## Protección
 *
 * Un secreto compartido en la cabecera. Sin él, cualquiera podría forzar el
 * vaciado de todos los lotes de todos los clientes — no leería nada, pero haría
 * responder al agente antes de tiempo y gastando dinero.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuántos lotes se procesan por barrido. */
const POR_BARRIDO = 20;

function secretoValido(recibido: string | null, esperado: string) {
  if (!recibido) return false;

  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);

  // Longitudes distintas ya no coinciden, y comparar buffers de distinto
  // tamaño hace saltar timingSafeEqual.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export async function POST(peticion: Request) {
  const esperado = process.env.INTERNAL_API_SECRET;

  /*
   * Sin secreto configurado, el endpoint se cierra en vez de quedarse abierto.
   * Un despliegue al que se le olvidó la variable no puede acabar con una
   * puerta sin cerradura.
   */
  if (!esperado) {
    console.error("[flush] falta INTERNAL_API_SECRET");
    return new Response("no disponible", { status: 503 });
  }

  if (!secretoValido(peticion.headers.get("x-internal-secret"), esperado)) {
    return new Response("no autorizado", { status: 401 });
  }

  const comenzado = Date.now();
  const lotes = await tomarLotesVencidos(POR_BARRIDO);

  const resultados = { respondidos: 0, abstenidos: 0, fallidos: 0 };

  /*
   * En serie y no en paralelo. Cada respuesta llama a un modelo, y lanzar
   * veinte a la vez multiplica el gasto por veinte en el mismo instante — justo
   * lo que los topes de gasto intentan evitar. Si un barrido no llega a todos,
   * el siguiente los recoge.
   */
  for (const lote of lotes) {
    try {
      const r = await responderConversacion({
        workspaceId: lote.workspace_id,
        conversacionId: lote.conversation_id,
      });

      if (r.clase === "enviada") resultados.respondidos++;
      else if (r.clase === "abstenida") resultados.abstenidos++;
      else resultados.fallidos++;

      await cerrarLote({
        workspaceId: lote.workspace_id,
        loteId: lote.id,
        error: r.clase === "error" ? r.motivo : undefined,
      });
    } catch (causa) {
      resultados.fallidos++;
      const motivo = causa instanceof Error ? causa.message : String(causa);
      await cerrarLote({ workspaceId: lote.workspace_id, loteId: lote.id, error: motivo });
    }
  }

  return Response.json({ ...resultados, lotes: lotes.length, ms: Date.now() - comenzado });
}
