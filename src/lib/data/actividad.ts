import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Lo que ha hecho el agente, y por qué.
 *
 * `events` se escribe desde el día uno y hasta ahora no lo miraba nadie. Ahí
 * está la respuesta a las dos preguntas que de verdad importan:
 *
 * - **«¿Por qué no contestó a esta clienta?»** — sin esto, la única salida es
 *   pedirle a alguien que mire los logs del servidor.
 * - **«¿Qué me estás dando por lo que te pago?»** — es la pregunta que va a
 *   hacer un cliente, y la respuesta tiene que ser un número.
 *
 * Se lee con la sesión de quien pregunta, así que RLS decide qué negocio puede
 * ver. Igual que el resto de las lecturas de la aplicación.
 */

export type MetricasDelMes = {
  conversaciones: number;
  /** Las que el agente llevó de principio a fin sin pasar a nadie. */
  resueltasSolo: number;
  /** Las que necesitaron una persona. */
  conPersona: number;
  mensajesRecibidos: number;
  respuestasDelAgente: number;
  respuestasDeUnaPersona: number;
  costeUsd: number;
  /** Cuánto cuesta de media atender una conversación. */
  costePorConversacion: number;
};

export type EntradaRegistro = {
  id: string;
  cuando: string;
  /** Frase en castellano, lista para leer. */
  texto: string;
  /** Para colorear: qué clase de suceso es. */
  tono: "normal" | "atencion" | "problema";
  conversacionId: string | null;
};

/**
 * Traducción de cada tipo de evento a una frase.
 *
 * Está aquí y no en la pantalla porque el mismo texto lo va a necesitar el
 * informe que se le enseña a un cliente. Y porque «ai.abstained /
 * tope_de_gasto» no se le puede poner delante a nadie: hay que decirle que su
 * agente dejó de contestar porque llegó al tope que él mismo puso.
 */
function describir(tipo: string, payload: Record<string, unknown>): EntradaRegistro["texto"] | null {
  const motivo = String(payload.motivo ?? "");

  switch (tipo) {
    case "message.received":
      return payload.con_adjunto ? "Llegó un mensaje con un archivo" : "Llegó un mensaje";

    case "ai.replied":
      return payload.handoff
        ? "El agente contestó y pasó la conversación a una persona"
        : "El agente contestó";

    case "human.replied":
      return "Contestaste tú";

    case "ai.abstained":
      return {
        freno_de_mano: "El agente no contestó: está parado para todo el negocio",
        ia_desactivada: "El agente no contestó: la IA está apagada en esta conversación",
        atiende_una_persona: "El agente no contestó: la conversación la lleva una persona",
        tope_de_gasto: "El agente dejó de contestar: se alcanzó el tope de gasto del mes",
        tope_por_contacto: "El agente no contestó: demasiadas respuestas seguidas a este contacto",
        limite_de_mensajes: "El agente no contestó: la conversación es demasiado larga",
        ventana_cerrada:
          "El agente no contestó: han pasado más de 24 h desde el último mensaje del contacto",
        ventana_desconocida: "El agente no contestó: no consta cuándo escribió el contacto",
      }[motivo] ?? `El agente no contestó (${motivo})`;

    case "handoff.requested":
      return {
        lo_pide_el_contacto: "El contacto pidió hablar con una persona",
        el_agente_se_rinde: "El agente no supo continuar y pidió ayuda",
        llego_un_archivo: "Llegó un archivo: el agente no lo ve, así que pasó a una persona",
      }[motivo] ?? "La conversación pasó a una persona";

    case "ai.failed":
      return `Falló al contestar (${payload.fase ?? "desconocido"})`;

    case "human.send_failed":
      return "No se pudo enviar tu mensaje";

    case "media.failed":
      return "Llegó un archivo que no se pudo guardar";

    case "webhook.signature_rejected":
      return "Se rechazó un mensaje con firma inválida";

    case "webhook.malformed":
      return "Llegó un aviso que no se pudo interpretar";

    case "ai.tested":
      return "Probaste el agente desde la plataforma";

    case "channel.prompt_updated":
      return "Cambiaste las instrucciones del agente";

    case "channel.credentials_updated":
      return "Se actualizaron las claves de WhatsApp";

    case "workspace.settings_updated":
      return "Cambiaste los ajustes del negocio";

    // Un tipo nuevo no debe romper la pantalla ni aparecer como ruido críptico.
    default:
      return null;
  }
}

const PROBLEMAS = new Set([
  "ai.failed",
  "human.send_failed",
  "media.failed",
  "webhook.signature_rejected",
  "webhook.malformed",
]);

const ATENCION = new Set(["handoff.requested", "ai.abstained"]);

/** El primer día del mes en curso, en ISO. */
function inicioDelMes(): string {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString();
}

export async function metricasDelMes(workspaceId: string): Promise<MetricasDelMes> {
  const supabase = await createClient();
  const desde = inicioDelMes();

  const { data: conversaciones } = await supabase
    .from("conversations")
    .select("id, state")
    .eq("workspace_id", workspaceId)
    .gte("created_at", desde)
    .overrideTypes<{ id: string; state: string }[], { merge: false }>();

  const { data: mensajes } = await supabase
    .from("messages")
    .select("direction, sender, cost")
    .eq("workspace_id", workspaceId)
    .gte("created_at", desde)
    .overrideTypes<
      { direction: "in" | "out"; sender: string; cost: { coste_usd?: number } | null }[],
      { merge: false }
    >();

  const filas = mensajes ?? [];
  const convs = conversaciones ?? [];

  /*
   * «Resuelta sola» = el agente la llevó sin que hiciera falta nadie. Es el
   * número que justifica la factura: no «cuántos mensajes mandó», que suena a
   * volumen, sino cuántas veces evitó que alguien tuviera que sentarse a
   * contestar.
   */
  const conPersona = convs.filter((c) => c.state === "handoff_pending" || c.state === "human_active").length;

  const costeUsd = filas.reduce((s, m) => s + Number(m.cost?.coste_usd ?? 0), 0);

  return {
    conversaciones: convs.length,
    resueltasSolo: convs.length - conPersona,
    conPersona,
    mensajesRecibidos: filas.filter((m) => m.direction === "in").length,
    respuestasDelAgente: filas.filter((m) => m.direction === "out" && m.sender === "ai").length,
    respuestasDeUnaPersona: filas.filter((m) => m.direction === "out" && m.sender === "human").length,
    costeUsd,
    costePorConversacion: convs.length > 0 ? costeUsd / convs.length : 0,
  };
}

/** Lo último que ha pasado, ya traducido. */
export async function registroReciente(
  workspaceId: string,
  limite = 60,
): Promise<EntradaRegistro[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("events")
    .select("id, type, payload, conversation_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limite)
    .overrideTypes<
      {
        id: string;
        type: string;
        payload: Record<string, unknown>;
        conversation_id: string | null;
        created_at: string;
      }[],
      { merge: false }
    >();

  return (data ?? []).flatMap((e) => {
    const texto = describir(e.type, e.payload ?? {});
    if (!texto) return [];

    return [
      {
        id: e.id,
        cuando: e.created_at,
        texto,
        tono: PROBLEMAS.has(e.type) ? "problema" : ATENCION.has(e.type) ? "atencion" : "normal",
        conversacionId: e.conversation_id,
      } satisfies EntradaRegistro,
    ];
  });
}
