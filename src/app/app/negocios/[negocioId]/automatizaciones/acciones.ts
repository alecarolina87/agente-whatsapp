"use server";

import { revalidatePath } from "next/cache";

import {
  admite,
  buscarAccion,
  buscarDisparador,
  configCompleta,
} from "@/lib/automatizaciones/catalogo";
import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";

/**
 * Crear, encender y borrar automatizaciones.
 *
 * Mismo patrón de las dos llaves que el resto: primero se comprueba el permiso
 * con la sesión de quien pide —y ahí decide RLS—, y solo después se escribe con
 * `scoped()`.
 *
 * ## Lo que se comprueba aquí aunque la pantalla ya lo impida
 *
 * Que la acción tenga sentido con el disparador, y que esté configurada del
 * todo. La pantalla filtra el desplegable, pero un formulario se puede mandar a
 * mano; y lo que hay al otro lado son mensajes que salen a clientas reales.
 */

export type EstadoAutomatizacion = { error?: string; ok?: boolean };

async function puedeGestionar(negocioId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  if (!data) return false;

  // Una escritura inocua contra la propia fila: si RLS la deja pasar, quien
  // pide es admin o manager. Es la misma comprobación que hará la escritura de
  // verdad, así que no puede decir una cosa distinta.
  const { error } = await supabase
    .from("workspaces")
    .update({ name: data.name })
    .eq("id", negocioId);

  return !error;
}

export async function crearAutomatizacion(
  negocioId: string,
  _previo: EstadoAutomatizacion,
  formData: FormData,
): Promise<EstadoAutomatizacion> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const nombre = String(formData.get("nombre") ?? "").trim();
  const claveDisparador = String(formData.get("disparador") ?? "");
  const claveAccion = String(formData.get("accion") ?? "");

  if (!nombre)
    return { error: "Ponle un nombre para reconocerla en la lista." };
  if (nombre.length > 80) return { error: "El nombre es demasiado largo." };

  const disparador = buscarDisparador(claveDisparador);
  const accion = buscarAccion(claveAccion);

  if (!disparador || !accion) return { error: "Elige cuándo y qué hacer." };

  if (!admite(claveDisparador, claveAccion)) {
    return {
      error: `«${accion.nombre}» no se puede usar con «${disparador.nombre}».`,
    };
  }

  const configDisparador: Record<string, string> = {};
  for (const campo of disparador.config) {
    configDisparador[campo.clave] = String(
      formData.get(`d_${campo.clave}`) ?? "",
    ).trim();
  }

  const configAccion: Record<string, string> = {};
  for (const campo of accion.config) {
    configAccion[campo.clave] = String(
      formData.get(`a_${campo.clave}`) ?? "",
    ).trim();
  }

  if (!configCompleta(disparador.config, configDisparador)) {
    return { error: "Faltan datos de cuándo tiene que saltar." };
  }

  if (!configCompleta(accion.config, configAccion)) {
    return { error: "Faltan datos de qué tiene que hacer." };
  }

  /*
   * Los huecos de la plantilla. Se guardan como JSON porque son una lista, y el
   * motor los lee con red por si algún día llegan mal.
   */
  if (claveAccion === "enviar_plantilla") {
    const valores = formData.getAll("a_valor").map((v) => String(v).trim());
    configAccion.valores = JSON.stringify(valores);

    if (valores.some((v) => !v)) {
      return { error: "Rellena todos los huecos de la plantilla." };
    }
  }

  const db = scoped(negocioId);

  const { error } = await db.from("automations").insert({
    nombre,
    disparador: claveDisparador,
    accion: claveAccion,
    config_disparador: configDisparador,
    config_accion: configAccion,
    /*
     * Nace apagada, siempre. Una automatización que se enciende al crearla
     * escribiría a las conversaciones viejas del negocio en el siguiente
     * barrido — sin que a nadie le haya dado tiempo a releerla.
     */
    activa: false,
  });

  if (error) {
    console.error("[automatizaciones] no se pudo crear", error.message);
    return { error: "No se pudo guardar. Inténtalo otra vez." };
  }

  revalidatePath(`/app/negocios/${negocioId}/automatizaciones`);
  return { ok: true };
}

export async function alternarAutomatizacion(
  negocioId: string,
  id: string,
  activa: boolean,
): Promise<EstadoAutomatizacion> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const db = scoped(negocioId);

  const { error } = await db
    .from("automations")
    .update({ activa, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[automatizaciones] no se pudo cambiar", error.message);
    return { error: "No se pudo cambiar. Inténtalo otra vez." };
  }

  revalidatePath(`/app/negocios/${negocioId}/automatizaciones`);
  return { ok: true };
}

export async function borrarAutomatizacion(
  negocioId: string,
  id: string,
): Promise<EstadoAutomatizacion> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const db = scoped(negocioId);
  const { error } = await db.from("automations").delete().eq("id", id);

  if (error) {
    console.error("[automatizaciones] no se pudo borrar", error.message);
    return { error: "No se pudo borrar. Inténtalo otra vez." };
  }

  revalidatePath(`/app/negocios/${negocioId}/automatizaciones`);
  return { ok: true };
}
