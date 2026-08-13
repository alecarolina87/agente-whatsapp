"use server";

import { revalidatePath } from "next/cache";

import { puedeEnviarTextoLibre } from "@/lib/agent/guardrails";
import { scoped } from "@/lib/data/scoped";
import { enviarPlantillaEnConversacion } from "@/lib/plantillas/enviar";
import { createClient } from "@/lib/supabase/server";
import { leerSecreto } from "@/lib/vault";
import { enviarTexto } from "@/lib/ycloud/client";

/**
 * Acciones del inbox.
 *
 * ## El patrón de las dos llaves
 *
 * Cada acción hace dos cosas con dos clientes distintos, y el orden importa:
 *
 * 1. **Comprobar el permiso con la sesión de quien pide.** La consulta va con
 *    su token, así que RLS decide: si la conversación no es de un workspace
 *    suyo, no la encuentra. No hace falta escribir ninguna comprobación.
 * 2. **Hacer el trabajo con la clave de servicio.** Leer una credencial de
 *    Vault o escribir en `events` necesita permisos que un usuario no tiene.
 *
 * Saltarse el paso 1 e ir directo al 2 sería dejar que cualquiera con sesión
 * modificara conversaciones de otro cliente pasando el identificador a mano.
 */

/** Devuelve el workspace de la conversación, o `null` si quien pide no la ve. */
async function conversacionPermitida(conversacionId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, contact_id, window_expires_at")
    .eq("id", conversacionId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        workspace_id: string;
        channel_id: string;
        contact_id: string;
        window_expires_at: string | null;
      },
      { merge: false }
    >();

  return data;
}

/** Enciende o apaga la IA en una conversación. */
export async function alternarIA(conversacionId: string, activar: boolean) {
  const conversacion = await conversacionPermitida(conversacionId);
  if (!conversacion) return { ok: false, error: "No encontrada" };

  const db = scoped(conversacion.workspace_id);

  await db
    .from("conversations")
    .update({
      ai_enabled: activar,
      // El estado acompaña al interruptor: si lo apagas es porque atiendes tú.
      state: activar ? "ai_active" : "human_active",
    })
    .eq("id", conversacionId);

  await db.from("events").insert({
    conversation_id: conversacionId,
    type: activar ? "ai.enabled" : "ai.disabled",
    actor: "human",
    payload: {},
  });

  revalidatePath(`/app/inbox/${conversacionId}`);
  revalidatePath("/app/inbox");
  return { ok: true };
}

/**
 * Envía un mensaje escrito por una persona.
 *
 * **Apaga la IA automáticamente.** Es la regla que evita el peor fallo de un
 * inbox con agente: que la persona conteste, y tres segundos después el agente
 * conteste otra cosa distinta a lo mismo. Quien escribe toma el control, y para
 * devolvérselo al agente hay que decirlo a propósito.
 */
export async function enviarComoHumano(conversacionId: string, texto: string) {
  const limpio = texto.trim();
  if (!limpio) return { ok: false, error: "El mensaje está vacío" };

  const conversacion = await conversacionPermitida(conversacionId);
  if (!conversacion) return { ok: false, error: "No encontrada" };

  /*
   * La ventana de 24 h vale igual para las personas: es una regla de Meta sobre
   * el número, no sobre quién escribe. Con la ventana cerrada, un texto libre
   * degrada la calidad del número aunque lo mande una persona.
   */
  const ventana = puedeEnviarTextoLibre(conversacion.window_expires_at);
  if (!ventana.permitido) {
    return {
      ok: false,
      error:
        ventana.motivo === "ventana_cerrada"
          ? "Han pasado más de 24 h desde el último mensaje del contacto. Para escribirle hace falta una plantilla aprobada."
          : "No se sabe si la ventana está abierta, así que no se envía.",
    };
  }

  const db = scoped(conversacion.workspace_id);

  const { data: canal } = await db
    .from("channels")
    .select("phone_number, ycloud_credential_ref")
    .eq("id", conversacion.channel_id)
    .maybeSingle()
    .overrideTypes<
      { phone_number: string; ycloud_credential_ref: string | null },
      { merge: false }
    >();

  const { data: contacto } = await db
    .from("contacts")
    .select("wa_phone")
    .eq("id", conversacion.contact_id)
    .maybeSingle()
    .overrideTypes<{ wa_phone: string }, { merge: false }>();

  if (!canal || !contacto)
    return { ok: false, error: "Canal o contacto no encontrado" };

  const apiKey = await leerSecreto(canal.ycloud_credential_ref);
  if (!apiKey)
    return { ok: false, error: "El canal no tiene credenciales de YCloud" };

  let envio;
  try {
    envio = await enviarTexto({
      apiKey,
      desde: canal.phone_number,
      hacia: contacto.wa_phone,
      texto: limpio,
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    await db.from("events").insert({
      conversation_id: conversacionId,
      type: "human.send_failed",
      actor: "human",
      payload: { motivo },
    });
    return { ok: false, error: "No se pudo enviar. Inténtalo otra vez." };
  }

  const ahora = new Date().toISOString();

  await db.from("messages").insert({
    conversation_id: conversacionId,
    direction: "out",
    type: "text",
    text: limpio,
    wamid: envio.wamid,
    sender: "human",
    status: "sent",
  });

  // Auto-pausa: quien escribe toma el control.
  await db
    .from("conversations")
    .update({
      ai_enabled: false,
      state: "human_active",
      last_outbound_at: ahora,
      last_message_at: ahora,
      unread_count: 0,
    })
    .eq("id", conversacionId);

  await db.from("events").insert({
    conversation_id: conversacionId,
    type: "human.replied",
    actor: "human",
    payload: { ycloud_id: envio.id, ia_pausada: true },
  });

  revalidatePath(`/app/inbox/${conversacionId}`);
  revalidatePath("/app/inbox");
  return { ok: true };
}

/** Marca como leída al abrir la conversación. */
export async function marcarLeida(conversacionId: string) {
  const conversacion = await conversacionPermitida(conversacionId);
  if (!conversacion) return;

  await scoped(conversacion.workspace_id)
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversacionId);
}

/**
 * Manda una plantilla aprobada a esta conversación.
 *
 * ## Por qué esto existe
 *
 * Es la salida del callejón. Con la ventana cerrada, `enviarComoHumano` dice
 * «hace falta una plantilla aprobada» y hasta ahora ahí se acababa todo: quien
 * atendía leía el aviso, no tenía forma de mandar ninguna, y la conversación se
 * quedaba muerta.
 *
 * ## Lo que NO comprueba, y es a propósito
 *
 * **No mira la ventana.** Las plantillas existen precisamente para saltársela;
 * comprobarla aquí impediría el único caso de uso que tienen. Lo que sí se
 * comprueba es que la plantilla esté aprobada: mandar una que no lo está hace
 * que Meta rechace el mensaje y la clienta no reciba nada.
 */
export async function enviarPlantillaAlContacto(
  conversacionId: string,
  plantillaId: string,
  valores: string[],
) {
  const conversacion = await conversacionPermitida(conversacionId);
  if (!conversacion) return { ok: false, error: "No encontrada" };

  const resultado = await enviarPlantillaEnConversacion({
    workspaceId: conversacion.workspace_id,
    conversacionId,
    plantillaId,
    valores,
    actor: "human",
  });

  if (!resultado.ok) return resultado;

  revalidatePath(`/app/inbox/${conversacionId}`);
  revalidatePath("/app/inbox");
  return { ok: true };
}
