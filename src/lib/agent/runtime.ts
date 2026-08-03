import "server-only";

import { scoped } from "@/lib/data/scoped";
import { completarChat } from "@/lib/openrouter/client";
import { leerSecreto } from "@/lib/vault";
import { enviarTexto } from "@/lib/ycloud/client";

import { puedeEnviarTextoLibre, superaLimiteDeMensajes } from "./guardrails";
import { evaluarHandoff, explicarHandoff, trajoArchivo, type MotivoHandoff } from "./handoff";
import { describirNegocio, type InfoNegocio } from "./info-negocio";
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
  respuesta_a_archivos: string;
};

type FilaMensaje = {
  direction: "in" | "out";
  type: string;
  text: string | null;
  created_at: string;
};

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

  /*
   * Pasar la conversación a una persona: cambia de dueño y la IA se apaga.
   *
   * Se hace en cuanto se sabe, **antes de enviar nada**. Si se dejara para
   * después del envío, un fallo de red o un tope de gasto dejaría la
   * conversación marcada como automática cuando ya sabemos que necesita a
   * alguien — y ahí se quedaría, sin que nadie la mirase.
   */
  const marcarHandoff = async (motivo: MotivoHandoff) => {
    await db
      .from("conversations")
      .update({ state: "handoff_pending", ai_enabled: false })
      .eq("id", conversacionId);

    await registrar("handoff.requested", { motivo, explicacion: explicarHandoff(motivo) });
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
    .select("id, phone_number, system_prompt, ycloud_credential_ref, respuesta_a_archivos")
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

  /*
   * La ficha del negocio. Puede no existir —es opcional— y en ese caso el
   * agente sigue funcionando con lo que diga su prompt, como hasta ahora.
   */
  const { data: info } = await db
    .from("business_info")
    .select("*")
    .maybeSingle()
    .overrideTypes<InfoNegocio, { merge: false }>();

  const contextoDelNegocio = describirNegocio(info);

  // Se piden los más recientes y se les da la vuelta: pedirlos ascendentes
  // obligaría a traer la conversación entera para quedarse con el final.
  const { data: recientes } = await db
    .from("messages")
    .select("direction, type, text, created_at")
    .eq("conversation_id", conversacionId)
    .order("created_at", { ascending: false })
    .limit(cuantosRecordar)
    .overrideTypes<FilaMensaje[], { merge: false }>();

  const historial = [...(recientes ?? [])].reverse();

  /*
   * ── 5. ¿Ha llegado un archivo? ────────────────────────────────────────────
   *
   * Se mira lo que el agente **aún no ha contestado**: todo lo que hay después
   * de su última respuesta. Mirar solo el último mensaje fallaría en el caso
   * más normal —foto, y a los tres segundos «¿esto es normal?»—, donde el
   * buffer junta los dos y el último es texto.
   *
   * Se marca el handoff aquí, antes de los topes de gasto, a propósito: si el
   * gasto está al límite el agente se callará, pero la foto tiene que quedar
   * señalada igual. Una foto sin contestar y sin marcar es una clienta
   * esperando a alguien que no sabe que la está esperando.
   */
  const ultimaRespuesta = historial.map((m) => m.direction).lastIndexOf("out");
  const sinContestar = historial.slice(ultimaRespuesta + 1);
  const hayArchivo = sinContestar.some((m) => trajoArchivo(m.type));

  if (hayArchivo) await marcarHandoff("llego_un_archivo");

  // ── 6. Tope de mensajes ───────────────────────────────────────────────────
  const { count: totalMensajes } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversacionId);

  if (superaLimiteDeMensajes(totalMensajes ?? 0)) {
    return abstenerse("limite_de_mensajes", { total: totalMensajes });
  }

  /*
   * ── 7. Frenos de gasto ────────────────────────────────────────────────────
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

  /*
   * ── 8. La respuesta ───────────────────────────────────────────────────────
   *
   * Con un archivo por medio **no se llama al modelo**. No es un ahorro: es que
   * el modelo no ha visto la foto, y lo que escribiera sobre ella se lo estaría
   * inventando. Se manda el acuse del canal y la conversación ya va camino de
   * una persona.
   */
  let respuesta: Awaited<ReturnType<typeof completarChat>> | null = null;
  let handoff: { texto: string; motivo: MotivoHandoff | null };

  if (hayArchivo) {
    handoff = { texto: canal.respuesta_a_archivos, motivo: "llego_un_archivo" };
  } else {
    const apiKeyModelo = process.env.OPENROUTER_API_KEY;
    const modelo = process.env.OPENROUTER_DEFAULT_MODEL;
    if (!apiKeyModelo || !modelo) {
      return { clase: "error", motivo: "falta la configuración de OpenRouter" };
    }

    try {
      respuesta = await completarChat({
        apiKey: apiKeyModelo,
        modelo,
        mensajes: construirMensajes({
          promptDelCanal: canal.system_prompt,
          infoDelNegocio: contextoDelNegocio,
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
     * ¿Hace falta una persona? Se decide **antes de enviar**, porque la marca
     * que pone el modelo no puede llegar al cliente bajo ningún concepto.
     * `evaluarHandoff` devuelve siempre el texto ya limpio, haya handoff o no.
     *
     * La respuesta se envía igualmente: el cliente merece una despedida, no un
     * silencio mientras espera a que alguien lea el aviso.
     */
    const ultimoDelContacto = [...historial].reverse().find((m) => m.direction === "in")?.text;

    handoff = evaluarHandoff({
      respuestaDelModelo: respuesta.texto,
      ultimoMensajeDelContacto: ultimoDelContacto,
    });

    if (handoff.motivo) await marcarHandoff(handoff.motivo);
  }

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
    // Sin llamada al modelo no hay coste que apuntar: el acuse de un archivo
    // sale gratis, y ponerle un cero inventado ensuciaría el recuento.
    cost: respuesta
      ? {
          modelo: respuesta.modelo,
          tokens_entrada: respuesta.uso.entrada,
          tokens_salida: respuesta.uso.salida,
          // El nombre lo lee  en SQL: si cambia aquí, hay que
          // cambiarlo también en la migración o el tope dejaría de contar.
          coste_usd: respuesta.uso.costeUsd,
        }
      : null,
  });

  // El estado de la conversación ya lo cambió `marcarHandoff` en cuanto se
  // supo; aquí solo quedan las marcas de tiempo.
  await db
    .from("conversations")
    .update({ last_outbound_at: ahora, last_message_at: ahora })
    .eq("id", conversacionId);

  await registrar("ai.replied", {
    wamid: envio.wamid,
    ycloud_id: envio.id,
    ycloud_status: envio.status,
    modelo: respuesta?.modelo ?? null,
    tokens_entrada: respuesta?.uso.entrada ?? 0,
    tokens_salida: respuesta?.uso.salida ?? 0,
    coste_usd: respuesta?.uso.costeUsd ?? 0,
    handoff: handoff.motivo,
    recortado: envio.recortado,
  });

  return { clase: "enviada", wamid: envio.wamid };
}
