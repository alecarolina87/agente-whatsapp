import "server-only";

import { scoped } from "@/lib/data/scoped";

/**
 * Buffer de silencio.
 *
 * La gente escribe por WhatsApp a trozos: "hola", "oye", "una pregunta" en diez
 * segundos. Sin buffer el agente contesta tres veces, paga tres llamadas al
 * modelo y la conversación queda absurda.
 *
 * Cada mensaje entrante entra en un lote abierto y **empuja hacia adelante** el
 * momento de contestar. Cuando pasan N segundos sin nada nuevo, se responde una
 * sola vez con todo el contexto.
 *
 * ## Las carreras las resuelve la base de datos, no el código
 *
 * Dos puntos donde dos peticiones simultáneas podrían duplicar la respuesta, y
 * cómo se cierra cada uno:
 *
 *   · **Al abrir el lote** — `unique (conversation_id) where status = 'open'`.
 *     Si dos mensajes llegan a la vez, el segundo choca contra el índice y en
 *     vez de crear otro lote actualiza el que ya hay.
 *   · **Al cerrarlo** — el paso a `flushing` es un `update` condicionado a que
 *     siga `open`. El que llega segundo no actualiza ninguna fila y se retira.
 */

export const ESTADO_LOTE = {
  abierto: "open",
  cerrando: "flushing",
  hecho: "done",
  fallido: "failed",
} as const;

/**
 * Mete un mensaje en el lote de su conversación y retrasa la respuesta.
 *
 * Devuelve el identificador del lote, para poder marcarlo en el mensaje.
 */
export async function encolarEnLote({
  workspaceId,
  conversacionId,
  segundosDeEspera,
}: {
  workspaceId: string;
  conversacionId: string;
  segundosDeEspera: number;
}): Promise<string | null> {
  const db = scoped(workspaceId);
  const cuandoResponder = new Date(Date.now() + segundosDeEspera * 1000).toISOString();

  /*
   * Se intenta insertar directamente. Si ya había un lote abierto, el índice
   * único lo rechaza con 23505 y entonces se actualiza el existente.
   *
   * Intentar primero y arreglar después —en vez de consultar y luego decidir—
   * es lo que hace que dos mensajes simultáneos no puedan crear dos lotes: la
   * comprobación y la escritura son la misma operación.
   */
  const { data: creado, error } = await db.from("message_batches").insert({
    conversation_id: conversacionId,
    status: ESTADO_LOTE.abierto,
    flush_at: cuandoResponder,
  });

  if (!error) return (creado?.[0] as { id: string } | undefined)?.id ?? null;

  if (error.code !== "23505") {
    console.error("[buffer] no se pudo abrir el lote", error.message);
    return null;
  }

  // Ya había uno abierto: se retrasa su respuesta y se reutiliza.
  const { data: actualizado } = await db
    .from("message_batches")
    .update({ flush_at: cuandoResponder })
    .eq("conversation_id", conversacionId)
    .eq("status", ESTADO_LOTE.abierto)
    .select("id")
    .overrideTypes<{ id: string }[], { merge: false }>();

  return actualizado?.[0]?.id ?? null;
}

export type LotePendiente = {
  id: string;
  workspace_id: string;
  conversation_id: string;
};

/**
 * Toma los lotes vencidos y los marca como en curso, de uno en uno.
 *
 * El paso a `flushing` va condicionado a que el lote siga `open`. Si dos
 * barridos coinciden, solo uno consigue actualizar la fila; el otro recibe cero
 * filas y lo salta. Sin esa condición, los dos creerían tener el lote y el
 * cliente recibiría dos respuestas.
 */
export async function tomarLotesVencidos(limite = 20): Promise<LotePendiente[]> {
  // Sin workspace conocido de antemano: este barrido es de toda la plataforma.
  const db = scoped("00000000-0000-0000-0000-000000000000");
  const cliente = db.raw("barrido global de lotes vencidos; no pertenece a un workspace concreto");

  const { data: vencidos } = await cliente
    .from("message_batches")
    .select("id, workspace_id, conversation_id")
    .eq("status", ESTADO_LOTE.abierto)
    .lte("flush_at", new Date().toISOString())
    .order("flush_at", { ascending: true })
    .limit(limite);

  const tomados: LotePendiente[] = [];

  for (const lote of (vencidos ?? []) as LotePendiente[]) {
    const { data: reclamado } = await cliente
      .from("message_batches")
      .update({ status: ESTADO_LOTE.cerrando })
      .eq("id", lote.id)
      .eq("status", ESTADO_LOTE.abierto) // ← el candado
      .select("id");

    if (reclamado?.length) tomados.push(lote);
  }

  return tomados;
}

/** Cierra un lote, con o sin éxito. */
export async function cerrarLote({
  workspaceId,
  loteId,
  error,
}: {
  workspaceId: string;
  loteId: string;
  error?: string;
}) {
  const db = scoped(workspaceId);

  await db
    .from("message_batches")
    .update({
      status: error ? ESTADO_LOTE.fallido : ESTADO_LOTE.hecho,
      ultimo_error: error ?? null,
      flushed_at: new Date().toISOString(),
    })
    .eq("id", loteId);
}
