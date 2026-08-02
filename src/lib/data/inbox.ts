import "server-only";

import type {
  ConversacionListada,
  HiloConversacion,
} from "@/lib/data/inbox-tipos";
import { createClient } from "@/lib/supabase/server";
import { urlFirmada, type MediaGuardada } from "@/lib/ycloud/media";

export type * from "@/lib/data/inbox-tipos";

/**
 * Lecturas del inbox.
 *
 * ## Por qué esto NO usa `scoped()`
 *
 * `scoped()` existe para el webhook y el motor del agente, que no tienen sesión
 * de usuario y usan la clave de servicio —la que se salta RLS—. Ahí el filtro
 * por workspace hay que ponerlo a mano, y por eso está encapsulado.
 *
 * Aquí es al revés: hay una persona con sesión iniciada, y las consultas van con
 * **su** token. Así el filtro lo aplica la base de datos con las políticas de
 * RLS, no el código. Si mañana alguien se equivoca escribiendo una consulta,
 * Postgres devuelve vacío en vez de datos de otro cliente.
 *
 * Usar la clave de servicio para pintar una pantalla sería tirar por la borda
 * la protección que se construyó en F0.
 */

/** Qué poner en el adelanto de la lista cuando el mensaje no tiene texto. */
const ETIQUETA_SIN_TEXTO: Record<string, string> = {
  image: "📷 Foto",
  audio: "🎤 Nota de voz",
  video: "🎥 Vídeo",
  document: "📎 Documento",
};

type FilaLista = {
  id: string;
  state: string;
  ai_enabled: boolean;
  unread_count: number;
  last_message_at: string | null;
  window_expires_at: string | null;
  contacts: { name: string | null; wa_phone: string } | null;
};

/** Las conversaciones del workspace, la más reciente primero. */
export async function listarConversaciones(
  workspaceId: string,
): Promise<ConversacionListada[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("conversations")
    .select(
      "id, state, ai_enabled, unread_count, last_message_at, window_expires_at, contacts(name, wa_phone)",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50)
    .overrideTypes<FilaLista[], { merge: false }>();

  if (!data?.length) return [];

  /*
   * El último texto de cada conversación va en una segunda consulta y no en un
   * join: en SQL, "la última fila de cada grupo" obliga a una subconsulta con
   * ventana que RLS complica. Con cincuenta conversaciones esto es una consulta
   * más, y se entiende de un vistazo.
   */
  const { data: ultimos } = await supabase
    .from("messages")
    .select("conversation_id, text, type, created_at")
    .in(
      "conversation_id",
      data.map((c) => c.id),
    )
    .order("created_at", { ascending: false })
    .limit(300)
    .overrideTypes<
      { conversation_id: string; text: string | null; type: string }[],
      { merge: false }
    >();

  const textoPorConversacion = new Map<string, string | null>();
  for (const m of ultimos ?? []) {
    if (!textoPorConversacion.has(m.conversation_id)) {
      /*
       * Una foto sin pie no tiene texto, y dejar la fila en blanco haría que
       * pareciera una conversación vacía justo cuando es la que más urge
       * mirar. El adelanto dice qué llegó.
       */
      textoPorConversacion.set(m.conversation_id, m.text || ETIQUETA_SIN_TEXTO[m.type] || null);
    }
  }

  return data.map((c) => ({
    id: c.id,
    estado: c.state,
    iaActiva: c.ai_enabled,
    sinLeer: c.unread_count,
    ultimoMensajeEn: c.last_message_at,
    ventanaCaducaEn: c.window_expires_at,
    contacto: {
      nombre: c.contacts?.name ?? null,
      telefono: c.contacts?.wa_phone ?? "?",
    },
    ultimoTexto: textoPorConversacion.get(c.id) ?? null,
  }));
}

/** Una conversación con su historial completo. */
export async function cargarHilo(
  workspaceId: string,
  conversacionId: string,
): Promise<HiloConversacion | null> {
  const supabase = await createClient();

  const { data: conversacion } = await supabase
    .from("conversations")
    .select("id, state, ai_enabled, window_expires_at, contacts(name, wa_phone)")
    .eq("workspace_id", workspaceId)
    .eq("id", conversacionId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        state: string;
        ai_enabled: boolean;
        window_expires_at: string | null;
        contacts: { name: string | null; wa_phone: string } | null;
      },
      { merge: false }
    >();

  // `null` puede significar que no existe o que no es de este workspace. Da
  // igual: quien pregunta no debe poder distinguir un caso del otro.
  if (!conversacion) return null;

  const { data: mensajes } = await supabase
    .from("messages")
    .select("id, direction, sender, text, type, status, media, created_at")
    .eq("conversation_id", conversacionId)
    .order("created_at", { ascending: true })
    .overrideTypes<
      {
        id: string;
        direction: "in" | "out";
        sender: string;
        text: string | null;
        type: string;
        status: string;
        media: MediaGuardada | null;
        created_at: string;
      }[],
      { merge: false }
    >();

  /*
   * Las URLs de los archivos se firman aquí, todas a la vez.
   *
   * Firmar con la clave de servicio dentro de una función que lee con la sesión
   * del usuario parece una grieta, y no lo es: para llegar hasta aquí la
   * consulta de arriba ya ha pasado por RLS, así que solo se firman rutas de
   * mensajes que esta persona puede leer. El bucket no tiene ninguna política
   * para `authenticated` justamente para que esta sea la única puerta.
   */
  const conArchivo = (mensajes ?? []).filter((m) => m.media?.ruta);
  const firmadas = new Map(
    await Promise.all(
      conArchivo.map(
        async (m) => [m.id, await urlFirmada(m.media!.ruta)] as const,
      ),
    ),
  );

  return {
    id: conversacion.id,
    estado: conversacion.state,
    iaActiva: conversacion.ai_enabled,
    ventanaCaducaEn: conversacion.window_expires_at,
    contacto: {
      nombre: conversacion.contacts?.name ?? null,
      telefono: conversacion.contacts?.wa_phone ?? "?",
    },
    mensajes: (mensajes ?? []).map((m) => ({
      id: m.id,
      direccion: m.direction,
      quien: m.sender,
      texto: m.text,
      tipo: m.type,
      estado: m.status,
      creadoEn: m.created_at,
      media: m.media?.ruta
        ? {
            url: firmadas.get(m.id) ?? null,
            mime: m.media.mime,
            nombre: m.media.nombre,
            bytes: m.media.bytes,
          }
        : null,
    })),
  };
}

/**
 * El workspace de la persona que ha iniciado sesión.
 *
 * De momento se coge el primero: con un solo cliente sobra. Cuando alguien
 * pertenezca a varios habrá que elegirlo, y ese selector es F4.
 */
export async function workspaceActual(): Promise<{ id: string; nombre: string } | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .limit(1)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  return data ? { id: data.id, nombre: data.name } : null;
}
