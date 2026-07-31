import "server-only";

import { scoped } from "@/lib/data/scoped";
import { completarChat } from "@/lib/openrouter/client";
import { leerSecreto } from "@/lib/vault";
import { enviarTexto } from "@/lib/ycloud/client";

import { puedeEnviarTextoLibre, superaLimiteDeMensajes } from "./guardrails";
import { evaluarHandoff, explicarHandoff } from "./handoff";
import { comprobarLimites, explicarFreno } from "./limites";
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
  | { clase: "enviada"; wamid: string | null }
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
  /*
   * Cuánto contexto se le pasa al modelo lo decide cada cliente, no el código:
   * un negocio con conversaciones largas necesita más memoria, y cada mensaje
   * de contexto se paga **en cada respuesta**. Estaba fijo en 20 y era una
   * decisión que no me correspondía tomar a mí.
   */
  const { data: ajustes } = await db
    .from("workspaces")
    .select("mensajes_de_contexto")
    .maybeSingle()
    .overrideTypes<{ mensajes_de_contexto: number }, { merge: false }>();

  const cuantosRecordar = ajustes?.mensajes_de_contexto ?? MENSAJES_DE_CONTEXTO;

  // Se piden los más recientes y se les da la vuelta: pedirlos ascendentes
  // obligaría a traer la conversación entera para quedarse con el final.
  const { data: recientes } = await db
    .from("messages")
    .select("direction, text, created_at")
    .eq("conversation_id", conversacionId)
    .order("created_at", { ascending: false })
    .limit(cuantosRecordar)
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

  /*
   * ── 6. Frenos de gasto ────────────────────────────────────────────────────
   *
   * Va justo antes de llamar al modelo, que es el último momento en que sirve
   * de algo: un céntimo después, ya está gastado. Y después de cargar el
   * historial a propósito, porque leer de la base de datos es gratis y llamar
   * al modelo no.
   */
  const limites = await comprobarLimites({ workspaceId, conversacionId });
  if (!limites.permitido) {
    return abstenerse(limites.motivo, {
      ...limites.detalle,
      explicacion: explicarFreno(limites.motivo),
    });
  }

  // ── 7. El modelo ──────────────────────────────────────────────────────────
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
        cuantos: cuantosRecordar,
      }),
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    await registrar("ai.failed", { fase: "modelo", motivo });
    return { clase: "error", motivo };
  }

  /*
   * ── 8. ¿Hace falta una persona? ───────────────────────────────────────────
   *
   * Se decide **antes de enviar**, porque la marca que pone el modelo no puede
   * llegar al cliente bajo ningún concepto. `evaluarHandoff` devuelve siempre
   * el texto ya limpio, haya handoff o no.
   *
   * La respuesta se envía igualmente: el cliente merece una despedida, no un
   * silencio mientras espera a que alguien lea el aviso.
   */
  const ultimoDelContacto = [...historial].reverse().find((m) => m.direction === "in")?.text;

  const handoff = evaluarHandoff({
    respuestaDelModelo: respuesta.texto,
    ultimoMensajeDelContacto: ultimoDelContacto,
  });

  // ── 9. El envío ───────────────────────────────────────────────────────────
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
      texto: handoff.texto,
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

  // ── 10. Dejar constancia ───────────────────────────────────────────────────
  const ahora = new Date().toISOString();

  await db.from("messages").insert({
    conversation_id: conversacionId,
    direction: "out",
    type: "text",
    text: handoff.texto,
    wamid: envio.wamid,
    sender: "ai",
    status: "sent",
    cost: {
      modelo: respuesta.modelo,
      tokens_entrada: respuesta.uso.entrada,
      tokens_salida: respuesta.uso.salida,
      // El nombre lo lee  en SQL: si cambia aquí, hay que
      // cambiarlo también en la migración o el tope dejaría de contar.
      coste_usd: respuesta.uso.costeUsd,
    },
  });

  /*
   * Con handoff, la conversación cambia de dueño: pasa a 'handoff_pending' y la
   * IA se apaga. Si siguiera activa, el próximo mensaje del cliente recibiría
   * otra respuesta automática justo cuando acaba de pedir una persona — y eso
   * es exactamente lo que hace que la gente pierda la paciencia con los bots.
   */
  await db
    .from("conversations")
    .update({
      last_outbound_at: ahora,
      last_message_at: ahora,
      ...(handoff.motivo
        ? { state: "handoff_pending", ai_enabled: false }
        : {}),
    })
    .eq("id", conversacionId);

  if (handoff.motivo) {
    await registrar("handoff.requested", {
      motivo: handoff.motivo,
      explicacion: explicarHandoff(handoff.motivo),
    });
  }

  await registrar("ai.replied", {
    wamid: envio.wamid,
    ycloud_id: envio.id,
    ycloud_status: envio.status,
    modelo: respuesta.modelo,
    tokens_entrada: respuesta.uso.entrada,
    tokens_salida: respuesta.uso.salida,
    coste_usd: respuesta.uso.costeUsd,
    recortado: envio.recortado,
  });

  return { clase: "enviada", wamid: envio.wamid };
}
