import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * ¿Qué le falta a este negocio para estar atendiendo de verdad?
 *
 * ## Por qué existe
 *
 * Un negocio puede estar dado de alta y no atender a nadie: sin claves, sin la
 * URL pegada en YCloud, sin instrucciones, sin saber nada del negocio. Y desde
 * fuera **parece que funciona** — aparece en la lista, tiene su ficha, su
 * número.
 *
 * Hoy eso se descubre cuando alguien escribe y no le contesta nadie. Con varios
 * clientes es cuestión de tiempo que pase.
 *
 * Ni el panel del curso ni ningún otro que se haya mirado tiene esto. Es la
 * pregunta que se hace de verdad al abrir la ficha de un cliente.
 */

export type Paso = {
  id: string;
  titulo: string;
  /** Qué pasa si falta. Escrito para leerse, no para un log. */
  consecuencia: string;
  hecho: boolean;
  /** `true` cuando faltarlo no impide atender, solo es imprudente. */
  opcional?: boolean;
  /** A dónde ir para resolverlo. */
  enlace?: string;
};

export type PuestaEnMarcha = {
  pasos: Paso[];
  /** Cuántos de los imprescindibles están hechos. */
  listos: number;
  imprescindibles: number;
  /** `true` si el negocio puede atender ahora mismo. */
  operativo: boolean;
};

type FilaNegocio = {
  ia_activa: boolean;
  tope_mensual_usd: number | null;
  channels: { status: string; system_prompt: string | null }[] | null;
};

export async function puestaEnMarcha(negocioId: string): Promise<PuestaEnMarcha | null> {
  const supabase = await createClient();

  const { data: negocio } = await supabase
    .from("workspaces")
    .select("ia_activa, tope_mensual_usd, channels(status, system_prompt)")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<FilaNegocio, { merge: false }>();

  if (!negocio) return null;

  const canal = negocio.channels?.[0] ?? null;

  const { data: ficha } = await supabase
    .from("business_info")
    .select("texto_libre, servicios")
    .eq("workspace_id", negocioId)
    .maybeSingle()
    .overrideTypes<{ texto_libre: string | null; servicios: unknown[] | null }, { merge: false }>();

  /*
   * Si alguna vez llegó un mensaje, la URL está pegada en YCloud. Es la única
   * forma honesta de saberlo sin preguntarle a YCloud: ese paso ocurre fuera de
   * esta plataforma y no hay manera de comprobarlo desde dentro.
   */
  const { count: recibidos } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", negocioId)
    .eq("type", "message.received");

  const { count: miembros } = await supabase
    .from("workspace_members")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", negocioId);

  const base = `/app/negocios/${negocioId}`;

  const pasos: Paso[] = [
    {
      id: "claves",
      titulo: "Su WhatsApp está conectado",
      consecuencia: "Sin las claves de YCloud, el webhook rechaza todo lo que llegue.",
      hecho: canal?.status === "active",
      enlace: `${base}/ajustes`,
    },
    {
      id: "webhook",
      titulo: "Su URL está pegada en YCloud",
      consecuencia:
        "Es el único paso que se hace fuera de aquí. Hasta que llegue el primer mensaje no hay forma de confirmarlo.",
      hecho: (recibidos ?? 0) > 0,
      enlace: base,
    },
    {
      id: "prompt",
      titulo: "El agente sabe cómo hablar",
      consecuencia:
        "Sin instrucciones propias contesta como cualquier otro: correcto y sin alma.",
      hecho: Boolean(canal?.system_prompt?.trim()),
      enlace: `${base}/probar`,
    },
    {
      id: "info",
      titulo: "El agente sabe del negocio",
      consecuencia:
        "Sin la ficha no puede decir precios, horarios ni servicios: contestará que no lo sabe.",
      hecho: Boolean(ficha?.texto_libre?.trim()) || (ficha?.servicios?.length ?? 0) > 0,
      enlace: `${base}/info`,
    },
    {
      id: "encendido",
      titulo: "El agente está en marcha",
      consecuencia: "Está parado con el freno de mano: recibe mensajes pero no contesta.",
      hecho: negocio.ia_activa,
      enlace: base,
    },
    {
      id: "tope",
      titulo: "Tiene tope de gasto",
      consecuencia:
        "Sin tope, el agente responde cueste lo que cueste. Un bucle o un día raro se lleva el margen.",
      hecho: negocio.tope_mensual_usd !== null,
      opcional: true,
      enlace: `${base}/ajustes`,
    },
    {
      id: "acceso",
      titulo: "El cliente puede entrar",
      consecuencia:
        "Solo tú ves este panel. El cliente no puede consultar sus conversaciones.",
      hecho: (miembros ?? 0) > 1,
      opcional: true,
      enlace: `${base}/equipo`,
    },
  ];

  const imprescindibles = pasos.filter((p) => !p.opcional);

  return {
    pasos,
    listos: imprescindibles.filter((p) => p.hecho).length,
    imprescindibles: imprescindibles.length,
    operativo: imprescindibles.every((p) => p.hecho),
  };
}
