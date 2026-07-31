import "server-only";

import { scoped } from "@/lib/data/scoped";
import { completarChat } from "@/lib/openrouter/client";
import { leerSecreto } from "@/lib/vault";
import { enviarTexto } from "@/lib/ycloud/client";

import { puedeEnviarTextoLibre, superaLimiteDeMensajes } from "./guardrails";
import { MENSAJES_DE_CONTEXTO, construirMensajes } from "./prompt";

/**
 * El motor: de una conversación con un mensaje nuevo, a una respuesta enviada.
 *
 * Se ejecuta **después** de que el webhook haya contestado a YCloud
 * (`after()`), así que aquí ya no hay prisa: se puede llamar al modelo y
 * esperar. Lo que sí hay que hacer es no dejar nunca la conversación en un
 * estado del que no se sepa qué pasó, y de ahí que cada salida quede escrita en
 * `events`.
 */

export type ResultadoRespuesta =
  | { clase: "enviada"; wamid: string }
  | { clase: "abstenida"; motivo: string }
  | { clase: "error"; motivo: string };

/*
 * Formas de las filas que se leen aquí. Mientras no se generen los tipos del
 * esquema de Supabase, esto es lo que hace que renombrar una columna salte en
 * este archivo en vez de a las tres de la mañana en producción.
 */
type FilaConversacion = {
  id: string;
  contact_id: string;
  channel_id: string;
  state: string;
  ai_enabled: boolean;
  window_expires_at: string | null;
};

type FilaCanal = {
  id: string;
  phone_number: string;
  system_prompt: string | null;
  ycloud_credential_ref: string | null;
};

type FilaMensaje = { direction: "in" | "out"; text: string | null; created_at: string };

export async function responderConversacion({
  workspaceId,
  conversacionId,
}: {
  workspaceId: string;
  conversacionId: string;
}): Promise<ResultadoRespuesta> {
  const db = scoped(workspaceId);

  const registrar = async (tipo: string, payload: Record<string, unknown>) => {
    await db.from("events").insert({
      conversation_id: conversacionId,
      type: tipo,
      actor: "ai",
      payload,
    });
  };

  const abstenerse = async (motivo: string, detalle: Record<string, unknown> = {}) => {
    await registrar("ai.abstained", { motivo, ...detalle });
    return { clase: "abstenida", motivo } as const;
  };

  // ── 1. La conversación ────────────────────────────────────────────────────
  const { data: conversacion } = await db
    .from("conversations")
    .select("id, contact_id, channel_id, state, ai_enabled, window_expires_at")
    .eq("id", conversacionId)
    .maybeSingle()
    .overrideTypes<FilaConversacion, { merge: false }>();

  if (!conversacion) return { clase: "error", motivo: "conversación no encontrada" };

  // Si hay una persona atendiendo, el agente se calla. Que los dos contesten a
  // la vez es peor que no contestar.
  if (!conversacion.ai_enabled) return abstenerse("ia_desactivada");
  if (conversacion.state === "human_active") return abstenerse("atiende_una_persona");

  // ── 2. La ventana de 24 h ─────────────────────────────────────────────────
  const ventana = puedeEnviarTextoLibre(conversacion.window_expires_at);
  if (!ventana.permitido) {
    return abstenerse(ventana.motivo, { window_expires_at: conversacion.window_expires_at });
  }

  // ── 3. El canal: personalidad y credenciales ──────────────────────────────
  const { data: canal } = await db
    .from("channels")
    .select("id, phone_number, system_prompt, ycloud_credential_ref")
    .eq("id", conversacion.channel_id)
    .maybeSingle()
    .overrideTypes<FilaCanal, { merge: false }>();

  if (!canal) return { clase: "error", motivo: "canal no encontrado" };

  const { data: contacto } = await db
    .from("contacts")
    .select("wa_phone")
    .eq("id", conversacion.contact_id)
    .maybeSingle()
    .overrideTypes<{ wa_phone: string }, { merge: false }>();

  if (!contacto) return { clase: "error", motivo: "contacto no encontrado" };

  // ── 4. El historial ───────────────────────────────────────────────────────
  // Se piden los más recientes y se les da la vuelta: pedirlos ascendentes
  // obligaría a traer la conversación entera para quedarse con el final.
  const { data: recientes } = await db
    .from("messages")
    .select("direction, text, created_at")
    .eq("conversation_id", conversacionId)
    .order("created_at", { ascending: false })
    .limit(MENSAJES_DE_CONTEXTO)
    .overrideTypes<FilaMensaje[], { merge: false }>();

  const historial = [...(recientes ?? [])].reverse();

  // ── 5. Tope de mensajes ───────────────────────────────────────────────────
  const { count: totalMensajes } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversacionId);

  if (superaLimiteDeMensajes(totalMensajes ?? 0)) {
    return abstenerse("limite_de_mensajes", { total: totalMensajes });
  }

  // ── 6. El modelo ──────────────────────────────────────────────────────────
  const apiKeyModelo = process.env.OPENROUTER_API_KEY;
  const modelo = process.env.OPENROUTER_DEFAULT_MODEL;
  if (!apiKeyModelo || !modelo) {
    return { clase: "error", motivo: "falta la configuración de OpenRouter" };
  }

  let respuesta;
  try {
    respuesta = await completarChat({
      apiKey: apiKeyModelo,
      modelo,
      mensajes: construirMensajes({
        promptDelCanal: canal.system_prompt,
        historial,
      }),
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    await registrar("ai.failed", { fase: "modelo", motivo });
    return { clase: "error", motivo };
  }

  // ── 7. El envío ───────────────────────────────────────────────────────────
  const apiKeyYCloud = await leerSecreto(canal.ycloud_credential_ref);
  if (!apiKeyYCloud) {
    await registrar("ai.failed", { fase: "credenciales", motivo: "canal sin clave de YCloud" });
    return { clase: "error", motivo: "el canal no tiene credenciales de YCloud" };
  }

  let envio;
  try {
    envio = await enviarTexto({
      apiKey: apiKeyYCloud,
      desde: canal.phone_number,
      hacia: contacto.wa_phone,
      texto: respuesta.texto,
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    /*
     * El mensaje no se guarda si no salió. Guardarlo como enviado dejaría a la
     * bandeja diciendo que se contestó algo que el cliente nunca recibió, y eso
     * es peor que un hueco: nadie iría a mirarlo.
     */
    await registrar("ai.failed", { fase: "envio", motivo });
    return { clase: "error", motivo };
  }

  // ── 8. Dejar constancia ───────────────────────────────────────────────────
  const ahora = new Date().toISOString();

  await db.from("messages").insert({
    conversation_id: conversacionId,
    direction: "out",
    type: "text",
    text: respuesta.texto,
    wamid: envio.wamid,
    sender: "ai",
    status: "sent",
    cost: {
      modelo: respuesta.modelo,
      tokens_entrada: respuesta.uso.entrada,
      tokens_salida: respuesta.uso.salida,
    },
  });

  await db
    .from("conversations")
    .update({ last_outbound_at: ahora, last_message_at: ahora })
    .eq("id", conversacionId);

  await registrar("ai.replied", {
    wamid: envio.wamid,
    modelo: respuesta.modelo,
    tokens_entrada: respuesta.uso.entrada,
    tokens_salida: respuesta.uso.salida,
    recortado: envio.recortado,
  });

  return { clase: "enviada", wamid: envio.wamid };
}
