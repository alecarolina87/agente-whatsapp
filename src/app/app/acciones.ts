"use server";

import { revalidatePath } from "next/cache";

import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";

/**
 * Acciones del panel del workspace.
 *
 * Mismo patrón que en el inbox: primero se comprueba el permiso con la sesión
 * de quien pide —RLS decide si ve ese workspace— y solo después se escribe con
 * la clave de servicio.
 */

async function workspacePermitido(workspaceId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle()
    .overrideTypes<{ id: string }, { merge: false }>();

  return Boolean(data);
}

/**
 * El freno de mano.
 *
 * Corta la IA de todo el workspace al instante. No para el webhook: los
 * mensajes se siguen recibiendo y guardando, y la bandeja funciona igual. Lo
 * único que deja de pasar es que el agente conteste.
 *
 * Esa distinción importa: si al parar el agente se perdieran los mensajes, dar
 * al botón tendría un coste y la gente dudaría antes de usarlo. Un freno de
 * emergencia que da miedo pulsar no sirve de nada.
 */
export async function alternarIaDelWorkspace(workspaceId: string, activar: boolean) {
  if (!(await workspacePermitido(workspaceId))) return { ok: false };

  const db = scoped(workspaceId);

  await db.from("workspaces").update({ ia_activa: activar }).eq("id", workspaceId);

  await db.from("events").insert({
    type: activar ? "workspace.ai_enabled" : "workspace.ai_killed",
    actor: "human",
    payload: {},
  });

  revalidatePath("/app", "layout");
  return { ok: true };
}
