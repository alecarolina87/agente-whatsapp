"use server";

import { revalidatePath } from "next/cache";

import { evaluarHandoff } from "@/lib/agent/handoff";
import { describirNegocio, type InfoNegocio } from "@/lib/agent/info-negocio";
import { conversar } from "@/lib/agent/conversar";
import { herramientasDelNegocio } from "@/lib/agent/herramientas";
import { elegirModelos } from "@/lib/agent/modelos";
import { MENSAJES_DE_CONTEXTO, construirMensajes } from "@/lib/agent/prompt";
import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";

/**
 * Hablar con el agente sin WhatsApp de por medio.
 *
 * ## Por qué esto importa más de lo que parece
 *
 * Escribirle la personalidad a un agente a ciegas y esperar a que llegue un
 * mensaje real para ver si funciona es la peor forma posible de iterar: el
 * ciclo son horas y hace falta una persona de verdad al otro lado. Aquí son
 * segundos.
 *
 * ## Lo que NO hace, y es deliberado
 *
 * **No escribe nada en las conversaciones.** El historial de la prueba vive en
 * el navegador y viaja en cada llamada. Si se guardara, la bandeja se llenaría
 * de conversaciones falsas mezcladas con las de clientas reales, y distinguir
 * unas de otras sería imposible justo cuando más prisa hay.
 *
 * **No manda ningún WhatsApp.** Lo único que cuesta son los tokens del modelo,
 * y lo que cuesta se devuelve en pantalla para que se vea.
 */

export type TurnoPrueba = { rol: "contacto" | "agente"; texto: string };

export type ResultadoPrueba =
  | {
      ok: true;
      texto: string;
      /** Si en una conversación de verdad esto habría pasado a una persona. */
      handoff: string | null;
      costeUsd: number;
      modelo: string;
      /** `true` si el modelo principal falló y contestó el de respaldo. */
      conRespaldo: boolean;
      /** Qué capacidades usó el agente para contestar. */
      herramientasUsadas: string[];
      tokens: { entrada: number; salida: number };
    }
  | { ok: false; error: string };

export async function probarAgente(
  negocioId: string,
  historial: TurnoPrueba[],
): Promise<ResultadoPrueba> {
  const supabase = await createClient();

  // Con la sesión de quien pide: si el negocio no es suyo, RLS no lo devuelve.
  const { data: negocio } = await supabase
    .from("workspaces")
    .select(
      "id, ia_activa, mensajes_de_contexto, tope_mensual_usd, modelo, modelo_respaldo",
    )
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        ia_activa: boolean;
        mensajes_de_contexto: number;
        tope_mensual_usd: number | null;
        modelo: string | null;
        modelo_respaldo: string | null;
      },
      { merge: false }
    >();

  if (!negocio) return { ok: false, error: "No se encuentra ese negocio." };

  /*
   * Los mismos frenos que en producción, salvo el límite por contacto, que
   * aquí no aplica porque no hay contacto. Si el agente está parado o el
   * negocio ha llegado a su tope, probar tampoco debe gastar: sería la puerta
   * de atrás que vacía justo el bolsillo que el tope protege.
   */
  if (!negocio.ia_activa) {
    return {
      ok: false,
      error: "El agente de este negocio está parado. Reanúdalo para probarlo.",
    };
  }

  if (negocio.tope_mensual_usd !== null) {
    const { data: gastado } = await supabase.rpc("gasto_del_mes", {
      p_workspace_id: negocioId,
    });
    if (Number(gastado ?? 0) >= negocio.tope_mensual_usd) {
      return {
        ok: false,
        error: "Este negocio ha llegado a su tope de gasto del mes.",
      };
    }
  }

  const db = scoped(negocioId);

  const { data: canales } = await db
    .from("channels")
    .select("system_prompt")
    .limit(1)
    .overrideTypes<{ system_prompt: string | null }[], { merge: false }>();

  const apiKey = process.env.OPENROUTER_API_KEY;

  /*
   * Los mismos modelos que en producción, respaldo incluido. Si la prueba
   * usara el modelo de la plataforma mientras el negocio tiene otro elegido,
   * estaría enseñando una calidad y un precio que no son los que va a recibir
   * la clienta — y eso es peor que no poder probar.
   */
  const modelos = elegirModelos({
    modelo: negocio.modelo,
    modeloRespaldo: negocio.modelo_respaldo,
  });

  if (!apiKey || !modelos)
    return { ok: false, error: "Falta la configuración del modelo." };

  /*
   * Se reutiliza `construirMensajes`, el mismo que usa el motor de verdad. Si
   * la prueba montara el prompt por su cuenta, probaría algo que no es lo que
   * pasa en producción — y una prueba que miente es peor que no probar.
   */
  // La misma ficha que usa el motor: si la prueba no la cargara, probaría un
  // agente que no es el que atiende de verdad.
  const { data: info } = await db
    .from("business_info")
    .select("*")
    .maybeSingle()
    .overrideTypes<InfoNegocio, { merge: false }>();

  const mensajes = construirMensajes({
    promptDelCanal: canales?.[0]?.system_prompt,
    infoDelNegocio: describirNegocio(info),
    historial: historial.map((t) => ({
      direction: t.rol === "contacto" ? ("in" as const) : ("out" as const),
      text: t.texto,
      created_at: new Date().toISOString(),
    })),
    cuantos: negocio.mensajes_de_contexto ?? MENSAJES_DE_CONTEXTO,
  });

  /*
   * Las mismas capacidades que en producción. Si la prueba no las cargara,
   * estarías probando un agente que no es el que atiende — y justo la parte
   * que más interesa comprobar es si sabe dar el enlace de reservas.
   */
  const herramientas = await herramientasDelNegocio(negocioId);

  let intento;
  try {
    intento = await conversar({ apiKey, modelos, mensajes, herramientas });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    return { ok: false, error: `El modelo no contestó: ${motivo}` };
  }

  const respuesta = intento.respuesta;

  // La marca de handoff se quita siempre, igual que en producción. Aquí además
  // se informa de que habría saltado: es parte de lo que se está probando.
  const ultimoDelContacto = [...historial]
    .reverse()
    .find((t) => t.rol === "contacto")?.texto;

  const handoff = evaluarHandoff({
    respuestaDelModelo: respuesta.texto,
    ultimoMensajeDelContacto: ultimoDelContacto,
  });

  /*
   * Queda registrado para que el gasto no sea invisible. No suma en
   * `gasto_del_mes` —esa función suma `messages.cost` y aquí no se guarda
   * ningún mensaje— así que el coste se devuelve también a la pantalla, que es
   * donde de verdad se ve mientras se prueba.
   */
  await db.from("events").insert({
    type: "ai.tested",
    actor: "human",
    payload: {
      modelo: respuesta.modelo,
      tokens_entrada: respuesta.uso.entrada,
      tokens_salida: respuesta.uso.salida,
      coste_usd: respuesta.uso.costeUsd,
      handoff: handoff.motivo,
      fallo_del_principal: intento.falloDelPrincipal,
      herramientas: intento.herramientasUsadas,
    },
  });

  return {
    ok: true,
    texto: handoff.texto,
    handoff: handoff.motivo,
    conRespaldo: intento.falloDelPrincipal !== null,
    herramientasUsadas: intento.herramientasUsadas,
    // OpenRouter no siempre informa del coste. Cero es honesto aquí: significa
    // «no lo sabemos», y las cifras que sí llegan siguen sumando bien.
    costeUsd: respuesta.uso.costeUsd ?? 0,
    modelo: respuesta.modelo,
    tokens: { entrada: respuesta.uso.entrada, salida: respuesta.uso.salida },
  };
}

/**
 * Guarda solo las instrucciones del agente.
 *
 * Existe aparte de los ajustes generales para que el ciclo «cambio una frase →
 * pruebo → cambio otra» sea un botón, y no un viaje a otra pantalla con otros
 * siete campos que no se están tocando.
 */
export async function guardarPrompt(
  negocioId: string,
  prompt: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  // Igual que en los ajustes: ver un negocio y poder cambiarlo son permisos
  // distintos, así que se comprueba con una escritura, no con un `select`.
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  if (!data) return { ok: false, error: "No se encuentra ese negocio." };

  const { error: sinPermiso } = await supabase
    .from("workspaces")
    .update({ name: data.name })
    .eq("id", negocioId);

  if (sinPermiso)
    return { ok: false, error: "No tienes permiso para cambiar este negocio." };

  if (prompt.length > 8000) {
    return {
      ok: false,
      error: "Las instrucciones no pueden pasar de 8000 caracteres.",
    };
  }

  const db = scoped(negocioId);
  await db.from("channels").update({ system_prompt: prompt.trim() || null });

  await db.from("events").insert({
    type: "channel.prompt_updated",
    actor: "human",
    // El contenido no: puede llevar datos del negocio y `events` se consulta
    // con menos cuidado que la tabla.
    payload: { largo: prompt.trim().length },
  });

  revalidatePath("/app", "layout");
  return { ok: true };
}
