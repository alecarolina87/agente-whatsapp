"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";
import { guardarSecreto, nombreSecreto } from "@/lib/vault";

/**
 * Ajustes de un negocio.
 *
 * Mismo patrón de las dos llaves que en el inbox: **primero se comprueba el
 * permiso con la sesión de quien pide** —RLS decide si es admin de ese
 * negocio— y solo después se escribe. Sin el primer paso, cualquiera con
 * sesión podría cambiarle la personalidad al agente de otro cliente pasando su
 * identificador a mano.
 */

export type EstadoAjustes = { error?: string; guardado?: boolean };

/** Devuelve `true` solo si quien pide puede gestionar este negocio. */
async function puedeGestionar(negocioId: string) {
  const supabase = await createClient();

  /*
   * Se comprueba con una escritura de prueba, no con un `select`: ver un
   * negocio y poder cambiarlo son permisos distintos —un `viewer` ve y no
   * toca—, y el `select` diría que sí a los dos. Actualizar el nombre por el
   * que ya tiene no cambia nada y solo pasa si la política de escritura deja.
   */
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  if (!data) return false;

  const { error } = await supabase
    .from("workspaces")
    .update({ name: data.name })
    .eq("id", negocioId);

  return !error;
}

const ajustes = z.object({
  nombre: z.string().trim().min(2, "El nombre necesita al menos dos letras").max(80),
  systemPrompt: z.string().trim().max(8000),
  respuestaArchivos: z
    .string()
    .trim()
    .min(1, "Hace falta algo que contestar cuando llega una foto")
    .max(1000),
  bufferSegundos: z.coerce
    .number()
    .int()
    .min(0, "No puede ser negativo")
    .max(300, "Más de cinco minutos de espera y el cliente ya se ha ido"),
  mensajesDeContexto: z.coerce
    .number()
    .int()
    .min(2, "Con menos de dos mensajes el agente no se entera de nada")
    .max(100, "Cada mensaje de contexto se paga en cada respuesta"),
  topeMensualUsd: z.string().trim(),
  topeRespuestasHora: z.coerce
    .number()
    .int()
    .min(1, "Al menos una respuesta por hora")
    .max(1000),
});

export async function guardarAjustes(
  negocioId: string,
  _previo: EstadoAjustes,
  formData: FormData,
): Promise<EstadoAjustes> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const datos = ajustes.safeParse({
    nombre: formData.get("nombre"),
    systemPrompt: formData.get("systemPrompt") ?? "",
    respuestaArchivos: formData.get("respuestaArchivos"),
    bufferSegundos: formData.get("bufferSegundos"),
    mensajesDeContexto: formData.get("mensajesDeContexto"),
    topeMensualUsd: formData.get("topeMensualUsd") ?? "",
    topeRespuestasHora: formData.get("topeRespuestasHora"),
  });

  if (!datos.success) return { error: datos.error.issues[0].message };

  const d = datos.data;

  // Vacío significa «sin tope», que no es lo mismo que un tope de cero: cero
  // dejaría al agente mudo desde el primer mensaje.
  const tope = d.topeMensualUsd === "" ? null : Number(d.topeMensualUsd);
  if (tope !== null && (!Number.isFinite(tope) || tope < 0)) {
    return { error: "El tope de gasto tiene que ser un número, o quedarse vacío." };
  }

  const db = scoped(negocioId);

  await db.from("workspaces").update({
    name: d.nombre,
    buffer_segundos: d.bufferSegundos,
    mensajes_de_contexto: d.mensajesDeContexto,
    tope_mensual_usd: tope,
    tope_respuestas_hora: d.topeRespuestasHora,
  }).eq("id", negocioId);

  await db.from("channels").update({
    system_prompt: d.systemPrompt || null,
    respuesta_a_archivos: d.respuestaArchivos,
  });

  await db.from("events").insert({
    type: "workspace.settings_updated",
    actor: "human",
    // Qué cambió, no a qué: el prompt puede tener información del negocio y
    // `events` es un registro que se consulta con menos cuidado que la tabla.
    payload: { campos: Object.keys(d) },
  });

  revalidatePath("/app", "layout");
  return { guardado: true };
}

const claves = z.object({
  apiKey: z.string().trim().min(8, "La API Key parece demasiado corta"),
  webhookSecret: z.string().trim().min(8, "El Webhook Secret parece demasiado corto"),
});

/**
 * Conecta —o reemplaza— las claves de YCloud del negocio.
 *
 * Va en su propia acción y no dentro de los ajustes generales por una razón
 * práctica: los campos de clave llegan vacíos siempre, porque un secreto no se
 * vuelve a mostrar. Si compartieran formulario, guardar el nombre del negocio
 * borraría las claves sin querer.
 */
export async function guardarClaves(
  negocioId: string,
  _previo: EstadoAjustes,
  formData: FormData,
): Promise<EstadoAjustes> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const datos = claves.safeParse({
    apiKey: formData.get("apiKey"),
    webhookSecret: formData.get("webhookSecret"),
  });

  if (!datos.success) return { error: datos.error.issues[0].message };

  /*
   * A Vault, nunca a la tabla. En `channels` solo queda el identificador del
   * secreto, así que ni un volcado de la base de datos expone las claves de
   * un cliente.
   */
  let refApi: string;
  let refWebhook: string;

  try {
    refApi = await guardarSecreto(nombreSecreto.ycloudApiKey(negocioId), datos.data.apiKey);
    refWebhook = await guardarSecreto(
      nombreSecreto.ycloudWebhook(negocioId),
      datos.data.webhookSecret,
    );
  } catch (causa) {
    // El mensaje de Vault no se enseña: puede llevar detalles internos, y aquí
    // no hay nada que la persona pueda hacer con ellos.
    console.error("[ajustes] no se pudieron guardar las claves", causa);
    return { error: "No se pudieron guardar las claves. Inténtalo otra vez." };
  }

  const db = scoped(negocioId);

  // El canal pasa a `active` aquí y no antes: es lo que hace que el webhook
  // empiece a aceptar sus mensajes.
  await db.from("channels").update({
    ycloud_credential_ref: refApi,
    webhook_secret_ref: refWebhook,
    status: "active",
  });

  await db.from("events").insert({
    type: "channel.credentials_updated",
    actor: "human",
    payload: {},
  });

  revalidatePath("/app", "layout");
  return { guardado: true };
}
