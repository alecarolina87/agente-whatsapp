import "server-only";

import { scoped } from "@/lib/data/scoped";

/**
 * Los contactos de un negocio.
 *
 * ## El consentimiento no es un adorno
 *
 * `opt_in` ya se marca solo cuando alguien escribe por WhatsApp: escribirte
 * **es** dar permiso, y así lo entiende Meta. El problema aparece al importar
 * una lista, donde ese permiso no viene de ninguna parte.
 *
 * Por eso la lista distingue quién tiene consentimiento y quién no, en vez de
 * enseñarlos todos iguales. Escribir a quien no lo dio no da un error bonito:
 * degrada la calidad del número y puede acabar con la cuenta de WhatsApp del
 * cliente bloqueada.
 */

export type Contacto = {
  id: string;
  wa_phone: string;
  name: string | null;
  email: string | null;
  tags: string[];
  opt_in: boolean;
  opt_in_source: string | null;
  source: string | null;
  last_interaction_at: string | null;
  created_at: string;
};

export type PaginaContactos = {
  contactos: Contacto[];
  total: number;
  /** Cuántos no tienen consentimiento registrado. */
  sinConsentimiento: number;
};

const CAMPOS =
  "id, wa_phone, name, email, tags, opt_in, opt_in_source, source, " +
  "last_interaction_at, created_at";

/** Cuántos se traen de una vez. Con más, la pantalla deja de ser usable. */
export const POR_PAGINA = 50;

export async function listarContactos(
  negocioId: string,
  { busqueda = "", pagina = 0 }: { busqueda?: string; pagina?: number } = {},
): Promise<PaginaContactos> {
  const db = scoped(negocioId);

  let consulta = db
    .from("contacts")
    .select(CAMPOS, { count: "exact" })
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);

  const limpia = busqueda.trim();

  if (limpia) {
    /*
     * Se busca por nombre y por teléfono a la vez. Quien atiende recuerda una
     * cosa o la otra, nunca sabe cuál va a funcionar — y obligar a elegir campo
     * antes de buscar es pedirle que adivine.
     *
     * Las comas y los paréntesis se quitan porque `or()` los usa como sintaxis:
     * un nombre con coma rompería la consulta entera.
     */
    const segura = limpia.replace(/[,()]/g, " ");
    consulta = consulta.or(`name.ilike.%${segura}%,wa_phone.ilike.%${segura}%`);
  }

  const { data, count } = await consulta.overrideTypes<
    Contacto[],
    { merge: false }
  >();

  const { count: sinConsentimiento } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("opt_in", false);

  return {
    contactos: data ?? [],
    total: count ?? 0,
    sinConsentimiento: sinConsentimiento ?? 0,
  };
}
