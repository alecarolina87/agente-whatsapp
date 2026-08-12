/**
 * Cómo es una plantilla y qué significa cada estado.
 *
 * ## Por qué está separado de `lib/data/plantillas.ts`
 *
 * Lo necesitan las dos orillas: el servidor para consultar, y el navegador para
 * pintar la lista. `lib/data/plantillas.ts` no vale porque es `server-only` —
 * arrastra la capa de datos, con la clave de servicio dentro, que es
 * exactamente lo que ese marcador impide que llegue al navegador.
 *
 * Es el mismo reparto que en `lib/agent/catalogo.ts`. Cuando algo hay que
 * enseñarlo **y** consultarlo, el tipo y las etiquetas van a un módulo puro.
 */

export type EstadoPlantilla =
  | "local"
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled"
  | "archived"
  | "in_appeal"
  | "deleted";

export type Plantilla = {
  id: string;
  name: string;
  language: string;
  category: "utility" | "marketing" | "authentication";
  status: EstadoPlantilla;
  header_text: string | null;
  body: string;
  footer_text: string | null;
  variable_count: number;
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/**
 * Qué significa cada estado, escrito para quien lo lee.
 *
 * Los nombres de Meta se guardan sin traducir —traducirlos en la base de datos
 * obligaría a mantener un diccionario y a adivinar qué significa un estado
 * nuevo el día que Meta lo añada— pero sí se traducen al enseñarlos.
 * «in_appeal» no le dice nada a nadie.
 */
export const EXPLICACION: Record<
  EstadoPlantilla,
  { texto: string; tono: "ok" | "espera" | "mal" }
> = {
  local: { texto: "Escrita, sin enviar a revisar", tono: "espera" },
  pending: { texto: "Meta la está revisando", tono: "espera" },
  approved: { texto: "Aprobada: ya se puede usar", tono: "ok" },
  rejected: { texto: "Meta la rechazó", tono: "mal" },
  paused: { texto: "Meta la pausó por baja calidad", tono: "mal" },
  disabled: { texto: "Meta la desactivó", tono: "mal" },
  archived: { texto: "Archivada", tono: "espera" },
  in_appeal: { texto: "Recurrida: Meta la está mirando otra vez", tono: "espera" },
  deleted: { texto: "Borrada", tono: "mal" },
};
