"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";
import { leerSecreto } from "@/lib/vault";
import { ErrorYCloud } from "@/lib/ycloud/client";
import {
  NOMBRE_VALIDO,
  buscarWabaId,
  contarVariables,
  crearPlantilla,
  listarPlantillas,
  sugerirNombre,
  traducirEstado,
} from "@/lib/ycloud/plantillas";

/**
 * Plantillas: escribirlas, mandarlas a Meta y reconciliar su estado.
 *
 * Mismo patrón de las dos llaves que en el resto: **primero se comprueba el
 * permiso con la sesión de quien pide** —RLS decide si puede gestionar ese
 * negocio— y solo después se escribe con `scoped()`.
 */

export type EstadoAccion = { error?: string; ok?: boolean; aviso?: string };

async function puedeGestionar(negocioId: string) {
  const supabase = await createClient();

  // Con una escritura de prueba y no con un `select`: ver y poder cambiar son
  // permisos distintos, y el `select` diría que sí a los dos.
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  if (!data) return false;

  const { error } = await supabase
    .from("workspaces")
    .update({ name: data.name })
    .eq("id", negocioId);

  return !error;
}

const esquema = z.object({
  nombre: z.string().trim().min(1, "Hace falta un nombre"),
  categoria: z.enum(["utility", "marketing", "authentication"]),
  cabecera: z.string().trim().max(60).optional(),
  cuerpo: z
    .string()
    .trim()
    .min(1, "El mensaje no puede estar vacío")
    .max(1024, "Meta no acepta cuerpos de más de 1024 caracteres"),
  pie: z.string().trim().max(60, "El pie no puede pasar de 60 caracteres").optional(),
});

export async function guardarBorrador(
  negocioId: string,
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const datos = esquema.safeParse({
    nombre: formData.get("nombre"),
    categoria: formData.get("categoria"),
    cabecera: formData.get("cabecera") || undefined,
    cuerpo: formData.get("cuerpo"),
    pie: formData.get("pie") || undefined,
  });

  if (!datos.success) return { error: datos.error.issues[0].message };

  const d = datos.data;

  /*
   * El nombre se normaliza en vez de rechazarlo. Meta solo acepta minúsculas,
   * números y guiones bajos, y quien escribe una plantilla no tiene por qué
   * saberlo — pero sí tiene que **ver** el nombre resultante, porque es el que
   * aparecerá en los errores de Meta. Por eso se devuelve como aviso.
   */
  const nombre = NOMBRE_VALIDO.test(d.nombre) ? d.nombre : sugerirNombre(d.nombre);

  if (!nombre) {
    return { error: "Ese nombre no deja ninguna letra ni número utilizable." };
  }

  const db = scoped(negocioId);

  const { error } = await db.from("templates").insert({
    name: nombre,
    language: "es",
    category: d.categoria,
    status: "local",
    header_text: d.cabecera ?? null,
    body: d.cuerpo,
    footer_text: d.pie ?? null,
    variable_count: contarVariables(d.cuerpo),
  });

  if (error) {
    // 23505 es el índice único (negocio, nombre, idioma). No es un fallo
    // técnico: es que ya existe una con ese nombre, y hay que decirlo así.
    if (error.code === "23505") {
      return { error: `Ya tienes una plantilla que se llama «${nombre}».` };
    }
    console.error("[plantillas] no se pudo guardar", error.message);
    return { error: "No se pudo guardar la plantilla. Inténtalo otra vez." };
  }

  await db.from("events").insert({
    type: "template.created",
    actor: "human",
    payload: { nombre, categoria: d.categoria, variables: contarVariables(d.cuerpo) },
  });

  revalidatePath(`/app/negocios/${negocioId}/plantillas`);

  return {
    ok: true,
    aviso:
      nombre !== d.nombre
        ? `Se guardó como «${nombre}»: Meta solo acepta minúsculas, números y guiones bajos.`
        : undefined,
  };
}

/**
 * Manda la plantilla a Meta.
 *
 * A partir de aquí ya no se puede editar: lo que se revisa es esto. Si Meta la
 * rechaza, se corrige y se vuelve a enviar.
 */
export async function enviarARevisar(
  negocioId: string,
  plantillaId: string,
): Promise<EstadoAccion> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const db = scoped(negocioId);

  const { data: plantilla } = await db
    .from("templates")
    .select("id, name, language, category, header_text, body, footer_text, status")
    .eq("id", plantillaId)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        name: string;
        language: string;
        category: "utility" | "marketing" | "authentication";
        header_text: string | null;
        body: string;
        footer_text: string | null;
        status: string;
      },
      { merge: false }
    >();

  if (!plantilla) return { error: "No se encuentra esa plantilla." };

  // Solo tiene sentido mandar lo que no está en revisión. Reenviar una
  // pendiente no la acelera; reenviar una aprobada crea un duplicado.
  if (!["local", "rejected"].includes(plantilla.status)) {
    return { error: "Solo se pueden enviar las que están sin enviar o rechazadas." };
  }

  const { data: canal } = await db
    .from("channels")
    .select("phone_number, ycloud_credential_ref, status")
    .limit(1)
    .overrideTypes<
      { phone_number: string; ycloud_credential_ref: string | null; status: string }[],
      { merge: false }
    >();

  const primero = canal?.[0];

  if (!primero?.ycloud_credential_ref) {
    return {
      error:
        "Este negocio todavía no tiene conectadas sus claves de YCloud, así que no hay a dónde mandar la plantilla.",
    };
  }

  const apiKey = await leerSecreto(primero.ycloud_credential_ref);
  if (!apiKey) return { error: "No se pudieron leer las claves de YCloud." };

  try {
    const wabaId = await buscarWabaId({ apiKey, telefono: primero.phone_number });

    const resultado = await crearPlantilla({
      apiKey,
      wabaId,
      borrador: {
        nombre: plantilla.name,
        idioma: plantilla.language,
        categoria: plantilla.category,
        cabecera: plantilla.header_text,
        cuerpo: plantilla.body,
        pie: plantilla.footer_text,
      },
    });

    await db
      .from("templates")
      .update({
        status: traducirEstado(resultado.estado),
        provider_template_id: resultado.id,
        // Se limpia el rechazo anterior: si esta vez la aprueban, dejar el
        // motivo viejo haría creer que sigue rechazada.
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", plantillaId);

    await db.from("events").insert({
      type: "template.submitted",
      actor: "human",
      payload: { nombre: plantilla.name, id_proveedor: resultado.id },
    });

    revalidatePath(`/app/negocios/${negocioId}/plantillas`);
    return { ok: true };
  } catch (causa) {
    /*
     * El mensaje de YCloud se enseña tal cual. Es feo, pero dice qué campo
     * está mal: un «no se pudo enviar» genérico obliga a adivinar, y aquí
     * adivinar cuesta otra ronda de revisión de Meta.
     */
    const motivo = causa instanceof ErrorYCloud ? causa.message : "Error inesperado";

    await db.from("events").insert({
      type: "template.submit_failed",
      actor: "human",
      payload: { nombre: plantilla.name, motivo },
    });

    return { error: motivo };
  }
}

/**
 * Vuelve a preguntar a YCloud por el estado de todas.
 *
 * Existe **aunque** los avisos lleguen por webhook. Si un evento se pierde —el
 * endpoint caído, un despliegue justo en ese momento—, sin esto la plantilla se
 * queda «pendiente» para siempre y nadie sabe por qué.
 */
export async function reconciliarEstados(negocioId: string): Promise<EstadoAccion> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const db = scoped(negocioId);

  const { data: canal } = await db
    .from("channels")
    .select("phone_number, ycloud_credential_ref")
    .limit(1)
    .overrideTypes<
      { phone_number: string; ycloud_credential_ref: string | null }[],
      { merge: false }
    >();

  const primero = canal?.[0];
  if (!primero?.ycloud_credential_ref) {
    return { error: "Este negocio no tiene claves de YCloud conectadas." };
  }

  const apiKey = await leerSecreto(primero.ycloud_credential_ref);
  if (!apiKey) return { error: "No se pudieron leer las claves de YCloud." };

  try {
    const wabaId = await buscarWabaId({ apiKey, telefono: primero.phone_number });
    const remotas = await listarPlantillas({ apiKey, wabaId });

    for (const remota of remotas) {
      /*
       * Se busca por nombre e idioma, igual que hace el webhook: es lo único
       * que identifica una plantilla en los dos lados. Las que estén en YCloud
       * y no aquí simplemente no actualizan nada — no se importan, porque una
       * plantilla que nadie escribió en esta plataforma no tiene autor ni
       * historia y aparecería de la nada.
       */
      await db
        .from("templates")
        .update({
          status: traducirEstado(remota.estado),
          rejection_reason: remota.motivoRechazo,
          provider_template_id: remota.idProveedor,
          updated_at: new Date().toISOString(),
        })
        .eq("name", remota.nombre)
        .eq("language", remota.idioma);
    }

    revalidatePath(`/app/negocios/${negocioId}/plantillas`);
    return { ok: true, aviso: `Comprobadas ${remotas.length} plantillas en YCloud.` };
  } catch (causa) {
    const motivo = causa instanceof ErrorYCloud ? causa.message : "Error inesperado";
    return { error: motivo };
  }
}

export async function borrarPlantilla(
  negocioId: string,
  plantillaId: string,
): Promise<EstadoAccion> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const db = scoped(negocioId);

  /*
   * Solo se borra de aquí. La que esté en Meta sigue existiendo, y es
   * deliberado: borrarla allí es una acción que no se puede deshacer y que
   * afecta a mensajes ya programados. Si alguien quiere quitarla de Meta, lo
   * hace desde YCloud a conciencia.
   */
  await db.from("templates").delete().eq("id", plantillaId);

  revalidatePath(`/app/negocios/${negocioId}/plantillas`);
  return { ok: true };
}
