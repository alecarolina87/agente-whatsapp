import "server-only";

import { scoped } from "@/lib/data/scoped";
import { enviarPlantillaEnConversacion } from "@/lib/plantillas/enviar";

import { buscarAccion, buscarDisparador } from "./catalogo";
import { esHoraDecente } from "./horario";

/**
 * El motor de las automatizaciones: lo que hace que las reglas ocurran.
 *
 * ## Lo que este archivo tiene que impedir, por orden de gravedad
 *
 * 1. **Repetir.** Un disparador de tiempo se cumple en cada barrido. Sin el
 *    registro de `automation_runs`, la misma clienta recibiría el mismo
 *    recordatorio cada diez minutos hasta que bloqueara el número.
 * 2. **Escribir de madrugada.** Ver `horario.ts`. La hora del recordatorio la
 *    hereda del momento en que escribió la clienta, y ese momento puede ser las
 *    once y media de la noche.
 * 3. **Meterse donde hay alguien.** Si una persona está atendiendo esa
 *    conversación, un recordatorio automático la pisa.
 * 4. **Gastar sin freno.** Cada plantilla se paga. Un tope por barrido hace que
 *    una regla mal puesta cueste unos euros y no la facturación del mes.
 *
 * Los cuatro están aquí y no en la pantalla a propósito: la pantalla se puede
 * saltar, esto no.
 */

/**
 * Cuántas conversaciones atiende una misma regla en un barrido.
 *
 * No es una optimización. Si un negocio activa hoy un recordatorio de 24 h y
 * tiene seiscientas conversaciones viejas, todas cumplen la condición **a la
 * vez**: seiscientas plantillas de golpe, pagadas, a gente que escribió hace
 * meses. Con el tope salen veinte cada diez minutos, hay tiempo de verlo en la
 * bandeja y apagarlo.
 */
export const MAX_POR_BARRIDO = 20;

export type FilaAutomatizacion = {
  id: string;
  workspace_id: string;
  nombre: string;
  disparador: string;
  accion: string;
  config_disparador: Record<string, unknown> | null;
  config_accion: Record<string, unknown> | null;
};

type Candidata = {
  id: string;
  contact_id: string;
  last_inbound_at: string | null;
};

export type ResultadoBarrido = {
  reglas: number;
  ejecutadas: number;
  fallidas: number;
};

/**
 * Marca que una regla ya se ocupó de esta ocasión.
 *
 * **Se reserva antes de ejecutar, no después.** Es el mismo candado que el
 * dedupe del webhook: si se hiciera después, dos barridos solapados —uno que
 * tarda más de diez minutos— pasarían los dos la comprobación y mandarían dos
 * mensajes. Insertando primero, el segundo choca contra el índice único y se
 * retira.
 *
 * El precio es conocido y aceptado: si el envío falla luego, esa ocasión se
 * queda marcada y no se reintenta. Preferible a mandarlo dos veces, que es lo
 * que la clienta sí nota.
 */
async function reservar({
  workspaceId,
  automationId,
  conversacionId,
  referencia,
}: {
  workspaceId: string;
  automationId: string;
  conversacionId: string;
  referencia: string;
}): Promise<boolean> {
  const db = scoped(workspaceId);

  const { error } = await db.from("automation_runs").insert({
    automation_id: automationId,
    conversation_id: conversacionId,
    referencia,
  });

  return !error;
}

/**
 * Conversaciones que llevan `horas` sin respuesta de la clienta.
 *
 * Las tres condiciones, y por qué cada una:
 *
 * · **`last_inbound_at` antiguo** — el silencio, que es el disparador.
 * · **`last_outbound_at > last_inbound_at`** — le contestamos. Perseguir a
 *   quien escribió y se quedó sin respuesta no es un recordatorio: es echarle
 *   más leña a un problema que tiene el negocio.
 * · **`status = 'open'`** — una conversación cerrada se cerró por algo.
 *
 * `state = 'human_active'` se descarta después, en `puedeActuar()`, porque
 * depende también de la acción.
 */
async function enSilencio({
  workspaceId,
  horas,
  limite,
}: {
  workspaceId: string;
  horas: number;
  limite: number;
}): Promise<Candidata[]> {
  const db = scoped(workspaceId);
  const corte = new Date(Date.now() - horas * 3600_000).toISOString();

  const { data } = await db
    .from("conversations")
    .select("id, contact_id, state, last_inbound_at, last_outbound_at")
    .eq("status", "open")
    .not("last_inbound_at", "is", null)
    .lte("last_inbound_at", corte)
    .order("last_inbound_at", { ascending: false })
    .limit(limite * 3)
    .overrideTypes<
      (Candidata & { state: string; last_outbound_at: string | null })[],
      { merge: false }
    >();

  /*
   * La comparación entre dos columnas se hace aquí y no en el filtro: PostgREST
   * compara una columna con un valor, no con otra columna, y meterlo en `raw()`
   * cambiaría una consulta legible por una cadena SQL que nadie revisa. De ahí
   * el `limite * 3`: se traen de sobra y se descartan las que no valen.
   */
  return (data ?? [])
    .filter((c) => c.state !== "human_active")
    .filter(
      (c) =>
        c.last_outbound_at !== null &&
        c.last_inbound_at !== null &&
        c.last_outbound_at > c.last_inbound_at,
    )
    .slice(0, limite)
    .map((c) => ({
      id: c.id,
      contact_id: c.contact_id,
      last_inbound_at: c.last_inbound_at,
    }));
}

/**
 * Los valores de los huecos de la plantilla, guardados como JSON.
 *
 * Se lee con red: es un `jsonb` que puede haber quedado mal de una versión
 * anterior o de un arreglo a mano en la base. Si reventara aquí, tumbaría el
 * barrido entero de ese negocio — todas las reglas, no solo la rota.
 */
function leerValores(crudo: unknown): string[] {
  if (Array.isArray(crudo)) return crudo.map(String);
  if (typeof crudo !== "string") return [];

  try {
    const leido: unknown = JSON.parse(crudo);
    return Array.isArray(leido) ? leido.map(String) : [];
  } catch {
    return [];
  }
}

/** Ejecuta la acción de una regla sobre una conversación. */
export async function ejecutarAccion({
  regla,
  conversacionId,
  contactoId,
}: {
  regla: FilaAutomatizacion;
  conversacionId: string;
  contactoId: string;
}): Promise<{ ok: boolean; motivo?: string }> {
  const db = scoped(regla.workspace_id);
  const config = (regla.config_accion ?? {}) as Record<string, string>;

  switch (regla.accion) {
    case "enviar_plantilla": {
      if (!config.plantillaId)
        return { ok: false, motivo: "la regla no dice qué plantilla mandar" };

      const resultado = await enviarPlantillaEnConversacion({
        workspaceId: regla.workspace_id,
        conversacionId,
        plantillaId: config.plantillaId,
        // Los huecos van con el mismo texto para todo el mundo. Se avisa en la
        // pantalla: una plantilla con la fecha de la cita no vale para esto.
        valores: leerValores(config.valores),
        actor: "system",
      });

      return resultado.ok
        ? { ok: true }
        : { ok: false, motivo: resultado.error };
    }

    case "poner_etiqueta": {
      const etiqueta = String(config.etiqueta ?? "").trim();
      if (!etiqueta)
        return { ok: false, motivo: "la regla no dice qué etiqueta poner" };

      const { data: contacto } = await db
        .from("contacts")
        .select("tags")
        .eq("id", contactoId)
        .maybeSingle()
        .overrideTypes<{ tags: string[] | null }, { merge: false }>();

      // Un Set: si ya la tiene, no se duplica. Es lo que pasaría cada vez que
      // la clienta se quedara callada otra vez.
      const etiquetas = new Set(contacto?.tags ?? []);
      etiquetas.add(etiqueta);

      await db
        .from("contacts")
        .update({ tags: [...etiquetas] })
        .eq("id", contactoId);

      return { ok: true };
    }

    case "pasar_a_persona": {
      await db
        .from("conversations")
        .update({ state: "handoff_pending", ai_enabled: false })
        .eq("id", conversacionId);

      return { ok: true };
    }

    default:
      /*
       * Está guardada en la base pero ya no existe en el catálogo: un
       * despliegue que quitó una acción. Se avisa y no se ejecuta nada, en
       * lugar de fallar en silencio.
       */
      return { ok: false, motivo: "acción desconocida" };
  }
}

/**
 * Decide si esta regla puede actuar ahora.
 *
 * El horario solo frena lo que llega a la clienta. Poner una etiqueta a las
 * tres de la mañana no molesta a nadie, y hacerlo esperar a las nueve
 * retrasaría sin motivo la única acción que es instantánea.
 */
function puedeActuar(claveAccion: string, ahora: Date): boolean {
  const accion = buscarAccion(claveAccion);
  if (!accion) return false;
  if (!accion.escribeAlContacto) return true;

  return esHoraDecente(ahora);
}

/**
 * Pasa una vez por las reglas de tiempo de un negocio.
 *
 * El freno de mano del workspace manda sobre todo esto: si alguien lo ha
 * echado, es porque algo va mal, y lo último que hace falta entonces es que
 * sigan saliendo mensajes solos.
 */
export async function barrerNegocio(
  workspaceId: string,
  ahora = new Date(),
): Promise<ResultadoBarrido> {
  const db = scoped(workspaceId);
  const resumen: ResultadoBarrido = { reglas: 0, ejecutadas: 0, fallidas: 0 };

  const { data: workspace } = await db
    .from("workspaces")
    .select("ia_activa")
    .maybeSingle()
    .overrideTypes<{ ia_activa: boolean }, { merge: false }>();

  if (!workspace?.ia_activa) return resumen;

  const { data: reglas } = await db
    .from("automations")
    .select(
      "id, workspace_id, nombre, disparador, accion, config_disparador, config_accion",
    )
    .eq("activa", true)
    .overrideTypes<FilaAutomatizacion[], { merge: false }>();

  for (const regla of reglas ?? []) {
    const disparador = buscarDisparador(regla.disparador);

    // Solo las de tiempo: las de evento saltan solas desde el webhook.
    if (!disparador || disparador.clase !== "tiempo") continue;
    if (!puedeActuar(regla.accion, ahora)) continue;

    resumen.reglas += 1;

    const horas = Number(
      (regla.config_disparador as Record<string, unknown> | null)?.horas ?? 24,
    );
    if (!Number.isFinite(horas) || horas < 1) continue;

    const candidatas = await enSilencio({
      workspaceId,
      horas,
      limite: MAX_POR_BARRIDO,
    });

    for (const conversacion of candidatas) {
      // La ocasión es el silencio concreto: si vuelve a escribir y se calla
      // otra vez, ese silencio es nuevo y merece su recordatorio.
      const referencia = conversacion.last_inbound_at ?? "";

      const libre = await reservar({
        workspaceId,
        automationId: regla.id,
        conversacionId: conversacion.id,
        referencia,
      });

      if (!libre) continue; // ya atendida

      const resultado = await ejecutarAccion({
        regla,
        conversacionId: conversacion.id,
        contactoId: conversacion.contact_id,
      });

      if (resultado.ok) resumen.ejecutadas += 1;
      else resumen.fallidas += 1;

      await db.from("events").insert({
        conversation_id: conversacion.id,
        type: resultado.ok ? "automation.ran" : "automation.failed",
        actor: "system",
        payload: {
          automatizacion: regla.nombre,
          disparador: regla.disparador,
          accion: regla.accion,
          ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
        },
      });
    }
  }

  return resumen;
}

/** Todos los negocios que tienen alguna regla de tiempo encendida. */
export async function barrerTodo(
  ahora = new Date(),
): Promise<ResultadoBarrido> {
  const db = scoped("00000000-0000-0000-0000-000000000000");
  const cliente = db.raw(
    "barrido global de automatizaciones; recorre todos los workspaces por definición",
  );

  const { data } = await cliente
    .from("automations")
    .select("workspace_id")
    .eq("activa", true);

  const negocios = [
    ...new Set(
      ((data ?? []) as { workspace_id: string }[]).map((f) => f.workspace_id),
    ),
  ];

  const total: ResultadoBarrido = { reglas: 0, ejecutadas: 0, fallidas: 0 };

  for (const workspaceId of negocios) {
    const parcial = await barrerNegocio(workspaceId, ahora);
    total.reglas += parcial.reglas;
    total.ejecutadas += parcial.ejecutadas;
    total.fallidas += parcial.fallidas;
  }

  return total;
}

/**
 * Dispara las reglas de evento de un negocio.
 *
 * Se llama desde donde ocurre la cosa —el webhook, cuando entra un contacto
 * nuevo— y no desde el barrido: esperar diez minutos para poner una etiqueta a
 * quien acaba de escribir sería tarde para lo único que sirve, que es verlo en
 * la bandeja mientras la conversación está viva.
 *
 * No lanza nunca. Una automatización mal configurada no puede tumbar la entrada
 * de mensajes: si esto reventara, el webhook devolvería 500 y YCloud
 * reintentaría el mensaje una y otra vez.
 */
export async function dispararEvento({
  workspaceId,
  disparador,
  conversacionId,
  contactoId,
  referencia,
}: {
  workspaceId: string;
  disparador: string;
  conversacionId: string;
  contactoId: string;
  referencia: string;
}): Promise<void> {
  try {
    const db = scoped(workspaceId);
    const ahora = new Date();

    const { data: reglas } = await db
      .from("automations")
      .select(
        "id, workspace_id, nombre, disparador, accion, config_disparador, config_accion",
      )
      .eq("activa", true)
      .eq("disparador", disparador)
      .overrideTypes<FilaAutomatizacion[], { merge: false }>();

    for (const regla of reglas ?? []) {
      if (!puedeActuar(regla.accion, ahora)) continue;

      const libre = await reservar({
        workspaceId,
        automationId: regla.id,
        conversacionId,
        referencia,
      });

      if (!libre) continue;

      const resultado = await ejecutarAccion({
        regla,
        conversacionId,
        contactoId,
      });

      await db.from("events").insert({
        conversation_id: conversacionId,
        type: resultado.ok ? "automation.ran" : "automation.failed",
        actor: "system",
        payload: {
          automatizacion: regla.nombre,
          disparador: regla.disparador,
          accion: regla.accion,
          ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
        },
      });
    }
  } catch (causa) {
    console.error(
      "[automatizaciones] fallo al disparar",
      causa instanceof Error ? causa.message : causa,
    );
  }
}
