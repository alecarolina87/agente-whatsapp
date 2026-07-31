import { after } from "next/server";

import { responderConversacion } from "@/lib/agent/runtime";
import { calcularCaducidadVentana } from "@/lib/agent/guardrails";
import { scoped } from "@/lib/data/scoped";
import { leerSecreto } from "@/lib/vault";
import { parsearEntrante } from "@/lib/ycloud/types";
import { verificarFirma } from "@/lib/ycloud/verify";

/**
 * Webhook de YCloud, uno por workspace.
 *
 * ## El orden importa y no es negociable (BLUEPRINT §14, paso 3)
 *
 *   cuerpo crudo → firma → dedupe → persistir → ACK <2 s → trabajo en after()
 *
 * Cada paso está donde está por una razón concreta, explicada en su sitio.
 *
 * ## Por qué el workspace va en la URL
 *
 * Para verificar la firma hace falta el secreto, y el secreto es distinto por
 * cliente. Averiguar de quién es el evento mirando el cuerpo no sirve: del
 * cuerpo no puede uno fiarse hasta *después* de verificar. El identificador en
 * la ruta rompe ese círculo. Y no debilita nada: quien adivine un identificador
 * sigue sin poder falsificar una firma, porque no tiene el secreto. Dice con
 * qué llave mirar, no abre la puerta.
 */

/*
 * Formas de las filas que se leen o escriben aquí. Mientras no se generen los
 * tipos del esquema de Supabase, esto es lo que hace que renombrar una columna
 * salte en este archivo y no en producción.
 */
type FilaCanal = { id: string; phone_number: string; webhook_secret_ref: string | null };
type FilaConId = { id: string };

/** El motor del agente necesita Node, no el runtime de borde. */
export const runtime = "nodejs";

/** Nunca cachear un webhook. */
export const dynamic = "force-dynamic";

export async function POST(
  peticion: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const comenzado = Date.now();
  const { workspaceId } = await params;

  /*
   * PASO 1 · El cuerpo, como texto y antes de parsear.
   *
   * Lo que está firmado es esta cadena exacta. Si se parseara a JSON y se
   * volviera a serializar, cambiarían los espacios o el orden de las claves y
   * la firma dejaría de coincidir con cada mensaje legítimo.
   */
  const cuerpoCrudo = await peticion.text();

  // El identificador de la URL lo escribe quien llama, así que se valida antes
  // de tocar la base de datos. `scoped()` exige un uuid y lanza si no lo es.
  let db;
  try {
    db = scoped(workspaceId);
  } catch {
    return new Response("no autorizado", { status: 401 });
  }

  /*
   * PASO 2 · El secreto de este workspace.
   *
   * Se toma del canal activo. Si hubiera más de uno no habría forma de saber
   * cuál usar sin mirar el cuerpo —y del cuerpo no nos fiamos todavía—, así que
   * se falla ruidosamente en vez de adivinar. El modelo real lo respalda: cada
   * cliente tiene una cuenta de YCloud, y una cuenta configura un webhook con
   * un secreto (SPIKE §4).
   */
  const { data: canales } = await db
    .from("channels")
    .select("id, phone_number, webhook_secret_ref")
    .eq("status", "active")
    .overrideTypes<FilaCanal[], { merge: false }>();

  if (!canales?.length) {
    console.warn(`[webhook] workspace ${workspaceId} sin canal activo`);
    return new Response("no autorizado", { status: 401 });
  }

  if (canales.length > 1) {
    console.error(
      `[webhook] workspace ${workspaceId} tiene ${canales.length} canales activos; ` +
        "no se puede elegir el secreto sin leer el cuerpo. Revisar el alta.",
    );
    return new Response("configuración ambigua", { status: 409 });
  }

  const canal = canales[0];
  const secreto = await leerSecreto(canal.webhook_secret_ref);

  if (!secreto) {
    console.warn(`[webhook] canal ${canal.id} sin secreto en Vault`);
    return new Response("no autorizado", { status: 401 });
  }

  /*
   * PASO 3 · La firma.
   *
   * Hasta aquí, del cuerpo no se ha creído nada. A partir de aquí, sí.
   */
  const firma = verificarFirma({
    cuerpoCrudo,
    cabecera: peticion.headers.get("YCloud-Signature"),
    secreto,
  });

  if (!firma.valida) {
    /*
     * El motivo se guarda pero no se devuelve. Contarle a quien llama si falló
     * por el secreto o por la ventana de tiempo le ayuda a afinar el ataque;
     * dentro, en cambio, es la diferencia entre un secreto mal copiado y un
     * reloj desincronizado.
     */
    await db.from("events").insert({
      type: "webhook.signature_rejected",
      actor: "system",
      payload: { motivo: firma.motivo, canal_id: canal.id },
    });

    return new Response("no autorizado", { status: 401 });
  }

  // ── A partir de aquí el evento es auténtico ────────────────────────────────

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(cuerpoCrudo);
  } catch {
    return new Response("cuerpo ilegible", { status: 400 });
  }

  const parseado = parsearEntrante(cuerpo);

  // Un evento que no nos toca —estados de entrega, ecos— es normal y se acepta.
  // Devolver error haría que YCloud reintentara algo que nunca vamos a querer.
  if (parseado.clase === "ignorado") {
    return Response.json({ ok: true, ignorado: parseado.motivo });
  }

  if (parseado.clase === "malformado") {
    await db.from("events").insert({
      type: "webhook.malformed",
      actor: "system",
      payload: { motivo: parseado.motivo },
    });
    // 200 a propósito: reintentar no va a arreglar un cuerpo que no entendemos,
    // y un 4xx repetido hace que YCloud acabe desactivando el webhook.
    return Response.json({ ok: true, ignorado: parseado.motivo });
  }

  const mensaje = parseado.mensaje;

  /*
   * PASO 4 · El candado de la deduplicación.
   *
   * Se **inserta** antes de procesar y se deja que falle el índice único. Si
   * primero se consultara y luego se insertara, dos reintentos simultáneos de
   * YCloud pasarían los dos la comprobación y el agente contestaría dos veces.
   * Con la inserción por delante, el segundo choca contra el índice (23505),
   * se responde 200 y no se procesa nada.
   */
  const { error: errorDedupe } = await db.from("processed_events").insert({
    event_id: mensaje.eventoId,
    source: "ycloud",
  });

  if (errorDedupe) {
    if (errorDedupe.code === "23505") {
      return Response.json({ ok: true, duplicado: true });
    }
    console.error("[webhook] fallo al registrar el evento", errorDedupe.message);
    // Aquí sí interesa que YCloud reintente: no hemos podido ni anotar el
    // evento, así que no se ha procesado.
    return new Response("error temporal", { status: 500 });
  }

  /*
   * PASO 5 · Persistir.
   *
   * Contacto → conversación → mensaje. El contacto por `upsert` porque dos
   * mensajes seguidos de la misma persona llegarían a la vez.
   */
  const ahora = new Date().toISOString();

  const { data: contactos, error: errorContacto } = await db.from("contacts").upsert(
    {
      wa_phone: mensaje.de,
      name: mensaje.nombreContacto,
      source: "whatsapp",
      // Escribió primero: eso es el opt-in, y se anota cuándo por si algún día
      // hay que demostrarlo.
      opt_in: true,
      opt_in_source: "inbound_whatsapp",
      opt_in_at: ahora,
      last_interaction_at: ahora,
    },
    { onConflict: "workspace_id,wa_phone" },
  ).overrideTypes<FilaConId[], { merge: false }>();

  const contacto = contactos?.[0];
  if (errorContacto || !contacto) {
    console.error("[webhook] fallo al guardar el contacto", errorContacto?.message);
    return new Response("error temporal", { status: 500 });
  }

  const { data: abiertas } = await db
    .from("conversations")
    .select("id")
    .eq("contact_id", contacto.id)
    .eq("channel_id", canal.id)
    .eq("status", "open")
    .limit(1)
    .overrideTypes<FilaConId[], { merge: false }>();

  let conversacionId: string | undefined = abiertas?.[0]?.id;

  /*
   * La ventana de 24 h se abre aquí. Sin esto el guardrail leería `null` y el
   * agente se abstendría siempre: es lo que convierte "el contacto ha escrito"
   * en "se le puede contestar".
   */
  const caducidad = calcularCaducidadVentana(new Date(ahora));

  if (!conversacionId) {
    const { data: nuevas, error: errorConversacion } = await db
      .from("conversations")
      .insert({
        contact_id: contacto.id,
        channel_id: canal.id,
        state: "ai_active",
        window_expires_at: caducidad,
        last_inbound_at: ahora,
        last_message_at: ahora,
        unread_count: 1,
      })
      .overrideTypes<FilaConId[], { merge: false }>();

    conversacionId = nuevas?.[0]?.id;
    if (errorConversacion || !conversacionId) {
      console.error("[webhook] fallo al crear la conversación", errorConversacion?.message);
      return new Response("error temporal", { status: 500 });
    }
  } else {
    await db
      .from("conversations")
      .update({ window_expires_at: caducidad, last_inbound_at: ahora, last_message_at: ahora })
      .eq("id", conversacionId);
  }

  const { error: errorMensaje } = await db.from("messages").insert({
    conversation_id: conversacionId,
    direction: "in",
    type: mensaje.tipo,
    text: mensaje.texto,
    wamid: mensaje.wamid,
    sender: "contact",
    status: "delivered",
  });

  // 23505 aquí significa que este mismo mensaje ya estaba guardado: el evento
  // era nuevo pero el mensaje no. Se sigue igual; no es un fallo.
  if (errorMensaje && errorMensaje.code !== "23505") {
    console.error("[webhook] fallo al guardar el mensaje", errorMensaje.message);
    return new Response("error temporal", { status: 500 });
  }

  await db.from("events").insert({
    conversation_id: conversacionId,
    type: "message.received",
    actor: "contact",
    payload: { wamid: mensaje.wamid, tipo: mensaje.tipo, ms_hasta_ack: Date.now() - comenzado },
  });

  /*
   * PASO 6 · Contestar ya, pensar después.
   *
   * `after()` corre cuando la respuesta ya ha salido. Llamar al modelo antes de
   * contestar se llevaría diez segundos, YCloud daría el envío por fallido y lo
   * reintentaría: el contacto recibiría la misma respuesta dos veces.
   */
  const idConversacion = conversacionId;
  after(async () => {
    try {
      await responderConversacion({ workspaceId, conversacionId: idConversacion });
    } catch (causa) {
      console.error("[webhook] el agente falló después del ACK", causa);
    }
  });

  return Response.json({ ok: true, ms: Date.now() - comenzado });
}
