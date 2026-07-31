import "server-only";

import { scoped } from "@/lib/data/scoped";

/**
 * Frenos de gasto y de abuso.
 *
 * Se comprueban **antes de llamar al modelo**, que es el único momento en que
 * sirven de algo: después de la llamada el dinero ya está gastado.
 *
 * Los tres son de naturaleza distinta y por eso se comprueban por separado:
 *
 *   · **Freno de mano** — manual, inmediato, para todo el workspace. Para
 *     cuando algo va mal y hay que parar ya.
 *   · **Tope de gasto** — automático, mensual. Para que un cliente con mucho
 *     tráfico no se lleve el margen del mes.
 *   · **Tope por contacto** — automático, por hora. Para que una sola persona
 *     escribiendo sin parar no consuma el tope de todos los demás.
 */

export type MotivoFreno = "freno_de_mano" | "tope_de_gasto" | "tope_por_contacto";

export type Veredicto =
  | { permitido: true }
  | { permitido: false; motivo: MotivoFreno; detalle: Record<string, unknown> };

/**
 * Decide si el agente puede responder.
 *
 * El orden va de lo más barato a lo más caro de comprobar: el freno de mano ya
 * viene leído con el workspace, el gasto es una función agregada y el tope por
 * contacto es un `count`. No tiene sentido contar mensajes si el freno de mano
 * ya está echado.
 */
export async function comprobarLimites({
  workspaceId,
  conversacionId,
}: {
  workspaceId: string;
  /**
   * La conversación, no el contacto: el tope es por persona, y los mensajes
   * cuelgan de la conversación. Contarlos de todo el workspace dejaría sin
   * agente a los demás clientes por culpa de uno solo.
   */
  conversacionId: string;
}): Promise<Veredicto> {
  const db = scoped(workspaceId);

  const { data: workspace } = await db
    .from("workspaces")
    .select("ia_activa, tope_mensual_usd, tope_respuestas_hora")
    .maybeSingle()
    .overrideTypes<
      {
        ia_activa: boolean;
        tope_mensual_usd: number | null;
        tope_respuestas_hora: number;
      },
      { merge: false }
    >();

  /*
   * Sin workspace no se responde. Podría parecer excesivo —lo normal es que
   * exista— pero el caso en que no existe es justo el que no queremos: una
   * conversación huérfana a la que el agente contestaría sin que nadie sepa a
   * cuenta de quién.
   */
  if (!workspace) {
    return { permitido: false, motivo: "freno_de_mano", detalle: { workspace: "no encontrado" } };
  }

  if (!workspace.ia_activa) {
    return { permitido: false, motivo: "freno_de_mano", detalle: {} };
  }

  // ── Tope de gasto ─────────────────────────────────────────────────────────
  if (workspace.tope_mensual_usd !== null) {
    const { data: gastado } = await db
      .raw("suma agregada del gasto del mes; no encaja en el molde de select con scope")
      .rpc("gasto_del_mes", { p_workspace_id: workspaceId });

    const gasto = Number(gastado ?? 0);
    if (gasto >= workspace.tope_mensual_usd) {
      return {
        permitido: false,
        motivo: "tope_de_gasto",
        detalle: { gastado: gasto, tope: workspace.tope_mensual_usd },
      };
    }
  }

  // ── Tope por contacto ─────────────────────────────────────────────────────
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  /*
   * Se cuentan las respuestas de la IA, no los mensajes del contacto. Es la
   * diferencia entre limitar lo que gastamos y limitar lo que alguien escribe:
   * que un cliente mande veinte mensajes seguidos no cuesta nada; contestarlos,
   * sí.
   */
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversacionId)
    .eq("sender", "ai")
    .gte("created_at", haceUnaHora);

  const respuestas = count ?? 0;
  if (respuestas >= workspace.tope_respuestas_hora) {
    return {
      permitido: false,
      motivo: "tope_por_contacto",
      detalle: {
        respuestas_ultima_hora: respuestas,
        tope: workspace.tope_respuestas_hora,
        conversacionId,
      },
    };
  }

  return { permitido: true };
}

/** Texto para los logs y para la pantalla. */
export function explicarFreno(motivo: MotivoFreno): string {
  switch (motivo) {
    case "freno_de_mano":
      return "La IA está desactivada en este workspace.";
    case "tope_de_gasto":
      return "Se ha alcanzado el tope de gasto del mes.";
    case "tope_por_contacto":
      return "Este contacto ha recibido demasiadas respuestas en la última hora.";
  }
}
