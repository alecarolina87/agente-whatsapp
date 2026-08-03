import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

/**
 * Los negocios que lleva la agencia.
 *
 * Igual que `inbox.ts`, esto lee **con la sesión de quien pregunta**, no con la
 * clave de servicio: el filtro lo aplica RLS a partir de `workspace_members`.
 * Si alguien escribe a mano el identificador de un cliente que no es suyo, la
 * base de datos devuelve vacío sin que haya que comprobar nada en el código.
 */

/** Dónde se recuerda qué negocio se está mirando. */
const COOKIE = "negocio";

export type NegocioListado = {
  id: string;
  nombre: string;
  slug: string;
  iaActiva: boolean;
  topeMensualUsd: number | null;
  /** Gasto del mes en curso, en dólares. */
  gastado: number;
  canal: {
    telefono: string;
    /** `active` solo si tiene sus dos claves de YCloud. */
    estado: string;
  } | null;
  /** Conversaciones que esperan a una persona. */
  esperando: number;
  /** Conversaciones abiertas. */
  abiertas: number;
};

type FilaWorkspace = {
  id: string;
  name: string;
  slug: string;
  ia_activa: boolean;
  tope_mensual_usd: number | null;
  channels: { phone_number: string; status: string }[] | null;
};

/**
 * Todos los negocios de la agencia, con su estado de un vistazo.
 *
 * El gasto se pide con una llamada por negocio. Es una consulta más por
 * cliente, pero la suma la hace Postgres: traerse los mensajes del mes para
 * sumarlos aquí funciona con cuatro y deja de funcionar con cuatro mil.
 */
export async function listarNegocios(): Promise<NegocioListado[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("workspaces")
    .select("id, name, slug, ia_activa, tope_mensual_usd, channels(phone_number, status)")
    .order("created_at", { ascending: true })
    .overrideTypes<FilaWorkspace[], { merge: false }>();

  if (!data?.length) return [];

  /*
   * Las conversaciones de todos los negocios en una sola consulta. RLS ya las
   * limita a los que son suyos, así que no hace falta filtrar por workspace:
   * pedirlo sería repetir en el código lo que la base de datos ya garantiza.
   */
  const { data: conversaciones } = await supabase
    .from("conversations")
    .select("workspace_id, state, ai_enabled, unread_count")
    .eq("status", "open")
    .overrideTypes<
      { workspace_id: string; state: string; ai_enabled: boolean; unread_count: number }[],
      { merge: false }
    >();

  const gastos = await Promise.all(
    data.map(async (w) => {
      const { data: gastado } = await supabase.rpc("gasto_del_mes", { p_workspace_id: w.id });
      return [w.id, Number(gastado ?? 0)] as const;
    }),
  );
  const gastoPorNegocio = new Map(gastos);

  return data.map((w) => {
    const suyas = (conversaciones ?? []).filter((c) => c.workspace_id === w.id);

    return {
      id: w.id,
      nombre: w.name,
      slug: w.slug,
      iaActiva: w.ia_activa,
      topeMensualUsd: w.tope_mensual_usd,
      gastado: gastoPorNegocio.get(w.id) ?? 0,
      // Un canal por negocio: es lo que asume el webhook, que falla
      // ruidosamente si encuentra dos activos.
      canal: w.channels?.[0]
        ? { telefono: w.channels[0].phone_number, estado: w.channels[0].status }
        : null,
      esperando: suyas.filter(
        (c) => c.state === "handoff_pending" || (!c.ai_enabled && c.unread_count > 0),
      ).length,
      abiertas: suyas.length,
    };
  });
}

/**
 * El negocio que se está mirando ahora mismo.
 *
 * Sale de una cookie, pero **no se cree**: se comprueba contra la base de
 * datos. Una cookie la edita cualquiera desde el navegador, y sin esta
 * comprobación bastaría con escribir ahí el identificador de otro cliente. RLS
 * lo pararía igual al leer sus datos, pero mejor que ni siquiera llegue a
 * intentarlo.
 *
 * Sin cookie válida se coge el primero, para que la aplicación nunca quede en
 * blanco esperando una elección que la mayoría de las veces es obvia.
 */
export async function negocioActual(): Promise<{ id: string; nombre: string } | null> {
  const supabase = await createClient();
  const elegido = (await cookies()).get(COOKIE)?.value;

  if (elegido) {
    const { data } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("id", elegido)
      .maybeSingle()
      .overrideTypes<{ id: string; name: string }, { merge: false }>();

    if (data) return { id: data.id, nombre: data.name };
  }

  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  return data ? { id: data.id, nombre: data.name } : null;
}

/** Solo el nombre de la cookie, para que las acciones no lo repitan. */
export const COOKIE_NEGOCIO = COOKIE;
