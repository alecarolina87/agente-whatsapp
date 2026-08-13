import "server-only";

import { scoped } from "@/lib/data/scoped";
import { leerSecreto } from "@/lib/vault";
import { enviarPlantilla } from "@/lib/ycloud/plantillas";

/**
 * Mandar una plantilla a una conversación.
 *
 * ## Por qué esto vive aquí y no dentro de la acción del inbox
 *
 * Ahora hay dos formas de mandar una plantilla: a mano desde la bandeja, y sola
 * desde una automatización. Si cada una tuviera su copia, en unos meses habría
 * dos verdades sobre lo mismo — y la que se olvidaría de actualizar sería
 * justamente la automática, que es la que no mira nadie.
 *
 * Lo único que cambia entre las dos es **quién la manda** (`actor`), y eso se
 * pasa como argumento porque en la bandeja tiene que verse la diferencia entre
 * un recordatorio que envió una persona y uno que salió solo.
 *
 * ## Lo que este módulo NO hace
 *
 * **No comprueba permisos.** Recibe el workspace ya resuelto y escribe con la
 * clave de servicio. Quien lo llame desde una pantalla tiene que haber
 * comprobado antes que quien pide puede ver esa conversación — es el patrón de
 * las dos llaves del inbox, y saltárselo aquí no daría ningún aviso.
 */

export type ResultadoEnvio = { ok: true } | { ok: false; error: string };

export async function enviarPlantillaEnConversacion({
  workspaceId,
  conversacionId,
  plantillaId,
  valores,
  actor,
}: {
  workspaceId: string;
  conversacionId: string;
  plantillaId: string;
  valores: string[];
  /** `human` si lo mandó alguien; `system` si fue una automatización. */
  actor: "human" | "system";
}): Promise<ResultadoEnvio> {
  const db = scoped(workspaceId);

  const { data: conversacion } = await db
    .from("conversations")
    .select("channel_id, contact_id")
    .eq("id", conversacionId)
    .maybeSingle()
    .overrideTypes<
      { channel_id: string; contact_id: string },
      { merge: false }
    >();

  if (!conversacion) return { ok: false, error: "Conversación no encontrada" };

  const { data: plantilla } = await db
    .from("templates")
    .select("id, name, language, body, variable_count, status")
    .eq("id", plantillaId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        name: string;
        language: string;
        body: string;
        variable_count: number;
        status: string;
      },
      { merge: false }
    >();

  if (!plantilla) return { ok: false, error: "No se encuentra esa plantilla." };

  if (plantilla.status !== "approved") {
    return {
      ok: false,
      error:
        "Esa plantilla no está aprobada por Meta todavía, así que no se puede enviar.",
    };
  }

  /*
   * Tantos valores como huecos, ni uno menos. Con menos, Meta rechaza el
   * mensaje entero: la clienta no recibe nada y en la bandeja aparece un fallo
   * que no explica por qué.
   */
  const limpios = valores.map((v) => v.trim());

  if (limpios.length !== plantilla.variable_count || limpios.some((v) => !v)) {
    return {
      ok: false,
      error: `Esta plantilla necesita ${plantilla.variable_count} ${
        plantilla.variable_count === 1 ? "dato" : "datos"
      }, y todos rellenos.`,
    };
  }

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
    envio = await enviarPlantilla({
      apiKey,
      desde: canal.phone_number,
      hacia: contacto.wa_phone,
      nombre: plantilla.name,
      idioma: plantilla.language,
      valores: limpios,
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    await db.from("events").insert({
      conversation_id: conversacionId,
      type: "template.send_failed",
      actor,
      payload: { plantilla: plantilla.name, motivo },
    });
    return { ok: false, error: `No se pudo enviar: ${motivo}` };
  }

  const ahora = new Date().toISOString();

  /*
   * Se guarda el cuerpo con los huecos ya rellenos. Guardar la plantilla en
   * crudo dejaría la bandeja llena de `{{1}}` y nadie sabría qué se envió de
   * verdad — que es justo lo que hay que poder mirar cuando una clienta
   * contesta «¿de qué cita me hablas?».
   */
  const textoEnviado = limpios.reduce(
    (texto, valor, i) => texto.replaceAll(`{{${i + 1}}}`, valor),
    plantilla.body,
  );

  await db.from("messages").insert({
    conversation_id: conversacionId,
    direction: "out",
    type: "template",
    text: textoEnviado,
    wamid: envio.wamid,
    sender: actor,
    status: "sent",
  });

  /*
   * Enviar una plantilla **no** abre la ventana de 24 h. La abre el cliente al
   * contestar, no nosotros al escribir. Por eso aquí no se toca
   * `window_expires_at`: hacerlo dejaría al agente creyendo que puede escribir
   * libremente cuando no puede.
   *
   * Y, a diferencia de escribir a mano, **tampoco se pausa la IA**. Escribir un
   * mensaje es meterse en una conversación; mandar una plantilla suele ser una
   * gestión —recordar una cita— y lo que se quiere después es justo lo
   * contrario: que cuando la clienta conteste «sí, confirmo», el agente lo
   * atienda. Pausarla dejaría esa respuesta esperando a que alguien se diera
   * cuenta. Quien quiera atender en persona tiene el interruptor arriba.
   *
   * Por lo mismo no se toca `state`: si la conversación ya estaba esperando a
   * una persona, mandar un recordatorio no resuelve eso.
   */
  await db
    .from("conversations")
    .update({
      last_outbound_at: ahora,
      last_message_at: ahora,
      unread_count: 0,
    })
    .eq("id", conversacionId);

  await db.from("events").insert({
    conversation_id: conversacionId,
    type: "template.sent",
    actor,
    payload: { plantilla: plantilla.name, ycloud_id: envio.id },
  });

  return { ok: true };
}
