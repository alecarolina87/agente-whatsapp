import "server-only";

import { scoped } from "@/lib/data/scoped";
import type { Plantilla } from "@/lib/plantillas/estados";

// Se reexportan para que quien consulte no tenga que importar de dos sitios.
export type { EstadoPlantilla, Plantilla } from "@/lib/plantillas/estados";
export { EXPLICACION } from "@/lib/plantillas/estados";

/**
 * Las plantillas de un negocio.
 *
 * ## El estado no es decoración
 *
 * Una plantilla solo sirve cuando Meta la aprueba, y eso puede tardar minutos o
 * días, o no llegar nunca. La pantalla tiene que decir la verdad en cada
 * momento — incluido «te la rechazaron, y por esto»—, porque lo contrario es
 * alguien reenviando la misma plantilla tres veces sin entender qué pasa.
 */

const CAMPOS =
  "id, name, language, category, status, header_text, body, footer_text, " +
  "variable_count, rejection_reason, submitted_at, reviewed_at, created_at";

export async function listarPlantillasDelNegocio(negocioId: string): Promise<Plantilla[]> {
  const db = scoped(negocioId);

  const { data } = await db
    .from("templates")
    .select(CAMPOS)
    .order("created_at", { ascending: false })
    .overrideTypes<Plantilla[], { merge: false }>();

  return data ?? [];
}

/**
 * Las que se pueden usar de verdad.
 *
 * Se filtra aquí y no en cada pantalla porque enviar una plantilla no aprobada
 * hace que Meta rechace el mensaje entero: la clienta no recibe nada y en la
 * bandeja aparece un fallo que no explica gran cosa.
 */
export async function plantillasAprobadas(negocioId: string): Promise<Plantilla[]> {
  const db = scoped(negocioId);

  const { data } = await db
    .from("templates")
    .select(CAMPOS)
    .eq("status", "approved")
    .order("name")
    .overrideTypes<Plantilla[], { merge: false }>();

  return data ?? [];
}

export async function contarAprobadas(negocioId: string): Promise<number> {
  const db = scoped(negocioId);

  const { count } = await db
    .from("templates")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved");

  return count ?? 0;
}
