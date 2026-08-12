"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { leerLista } from "@/lib/contactos/importar";
import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";
import { normalizarE164 } from "@/lib/ycloud/normalize";

/**
 * Añadir e importar contactos.
 *
 * ## El consentimiento se declara, no se supone
 *
 * Cuando alguien escribe por WhatsApp, `opt_in` se marca solo: escribirte **es**
 * dar permiso. Una lista importada no trae ese permiso de ninguna parte, así
 * que aquí hay que decir de dónde salió — y si no salió de ningún sitio, los
 * contactos entran marcados como sin consentimiento en vez de mentir.
 *
 * No es burocracia: escribir a quien no dio permiso degrada la calidad del
 * número del cliente y puede acabar con su cuenta de WhatsApp bloqueada. El
 * daño no lo pagamos nosotros, lo paga la clínica.
 */

export type EstadoContacto = { error?: string; ok?: boolean; resumen?: string };

/** Solo quien puede gestionar el negocio toca sus contactos. */
async function puedeGestionar(negocioId: string) {
  const supabase = await createClient();

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

const unContacto = z.object({
  telefono: z.string().trim().min(1, "Hace falta el teléfono"),
  nombre: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).optional(),
});

export async function anadirContacto(
  negocioId: string,
  _previo: EstadoContacto,
  formData: FormData,
): Promise<EstadoContacto> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const datos = unContacto.safeParse({
    telefono: formData.get("telefono"),
    nombre: formData.get("nombre") || undefined,
    email: formData.get("email") || undefined,
  });

  if (!datos.success) return { error: datos.error.issues[0].message };

  /*
   * Se normaliza antes de guardar, no después. El índice único compara texto:
   * si entrara `+34 600 00 00 00` y ya existiera `+34600000000`, el índice
   * vería dos valores distintos y la misma persona quedaría duplicada.
   */
  const telefono = normalizarE164(datos.data.telefono);

  if (!telefono) {
    return {
      error: "Ese teléfono no tiene una forma válida. Ejemplo: +34600000000",
    };
  }

  const db = scoped(negocioId);

  const { error } = await db.from("contacts").insert({
    wa_phone: telefono,
    name: datos.data.nombre ?? null,
    email: datos.data.email ?? null,
    source: "manual",
    /*
     * Añadir a alguien a mano **no** es consentimiento. Quien lo apunta suele
     * tenerlo —se lo acaban de dar en el mostrador— pero eso lo declara en la
     * importación, no lo damos por hecho aquí.
     */
    opt_in: false,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Ese teléfono ya está en la lista." };
    }
    console.error("[contactos] no se pudo añadir", error.message);
    return { error: "No se pudo añadir. Inténtalo otra vez." };
  }

  revalidatePath("/app/contactos");
  return { ok: true, resumen: `Añadido ${telefono}.` };
}

const importacion = z.object({
  lista: z.string().trim().min(1, "Pega al menos una línea"),
  origen: z.string().trim().max(200, "Con 200 caracteres sobra").optional(),
  conConsentimiento: z.boolean(),
});

/** Tope por tanda. Con más, la escritura tarda tanto que parece colgada. */
const MAXIMO_POR_TANDA = 1000;

export async function importarContactos(
  negocioId: string,
  _previo: EstadoContacto,
  formData: FormData,
): Promise<EstadoContacto> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const datos = importacion.safeParse({
    lista: formData.get("lista"),
    origen: formData.get("origen") || undefined,
    conConsentimiento: formData.get("conConsentimiento") === "si",
  });

  if (!datos.success) return { error: datos.error.issues[0].message };

  /*
   * Si se declara consentimiento hay que decir de dónde: «dieron permiso» sin
   * más no sirve el día que alguien reclame. Con origen concreto —«formulario
   * de la web, mayo 2026»— hay algo que enseñar.
   */
  if (datos.data.conConsentimiento && !datos.data.origen) {
    return {
      error:
        "Si declaras que dieron permiso, escribe de dónde salió (te lo pedirán algún día).",
    };
  }

  const leido = leerLista(datos.data.lista);

  if (leido.validas.length === 0) {
    return {
      error:
        leido.descartadas.length > 0
          ? `No se reconoció ningún teléfono. La primera línea que falla es la ${leido.descartadas[0].linea}: «${leido.descartadas[0].texto}».`
          : "No se reconoció ningún teléfono en lo que has pegado.",
    };
  }

  if (leido.validas.length > MAXIMO_POR_TANDA) {
    return {
      error: `Son ${leido.validas.length} contactos y el máximo por tanda es ${MAXIMO_POR_TANDA}. Pégalos en varias veces.`,
    };
  }

  const db = scoped(negocioId);
  const ahora = new Date().toISOString();

  /*
   * `upsert` con `ignoreDuplicates` en vez de insertar uno a uno y capturar el
   * error: quien importa suele traer gente que ya está —vuelve a pegar la lista
   * entera— y eso tiene que ser inofensivo, no un fallo.
   *
   * Y **no se pisa** lo que ya hubiera. Alguien que escribió por WhatsApp tiene
   * `opt_in: true` de verdad; sobrescribirlo con lo declarado en una
   * importación sería degradar un dato bueno con uno peor.
   */
  const { data: insertados, error } = await db.from("contacts").upsert(
    leido.validas.map((fila) => ({
      wa_phone: fila.telefono,
      name: fila.nombre,
      source: "importado",
      opt_in: datos.data.conConsentimiento,
      opt_in_source: datos.data.conConsentimiento
        ? (datos.data.origen ?? null)
        : null,
      opt_in_at: datos.data.conConsentimiento ? ahora : null,
    })),
    /*
     * `ignoreDuplicates` hace un `ON CONFLICT DO NOTHING`, que devuelve **solo
     * las filas realmente insertadas**. De ahí sale el recuento de nuevos, y de
     * paso es lo que hace que volver a pegar la misma lista sea inofensivo en
     * vez de un error: quien importa suele traer gente que ya está.
     *
     * Y no pisa lo que hubiera: alguien que escribió por WhatsApp tiene
     * `opt_in` de verdad, y sobrescribirlo con lo declarado aquí sería cambiar
     * un dato bueno por uno peor.
     */
    { onConflict: "workspace_id,wa_phone", ignoreDuplicates: true },
  );

  if (error) {
    console.error("[contactos] falló la importación", error.message);
    return { error: "No se pudo importar. Inténtalo otra vez." };
  }

  const nuevos = insertados?.length ?? 0;
  const yaEstaban = leido.validas.length - nuevos;

  await db.from("events").insert({
    type: "contacts.imported",
    actor: "human",
    payload: {
      nuevos,
      ya_estaban: yaEstaban,
      descartadas: leido.descartadas.length,
      // Queda registrado qué se declaró: es lo que hay que poder enseñar el día
      // que alguien pregunte de dónde salió su número.
      con_consentimiento: datos.data.conConsentimiento,
      origen: datos.data.origen ?? null,
    },
  });

  const partes = [
    `${nuevos} ${nuevos === 1 ? "contacto nuevo" : "contactos nuevos"}`,
  ];
  if (yaEstaban > 0) partes.push(`${yaEstaban} ya estaban`);
  if (leido.repetidas > 0)
    partes.push(`${leido.repetidas} repetidos en la lista`);
  if (leido.descartadas.length > 0) {
    partes.push(
      `${leido.descartadas.length} sin teléfono válido (línea ${leido.descartadas
        .slice(0, 3)
        .map((d) => d.linea)
        .join(", ")}${leido.descartadas.length > 3 ? "…" : ""})`,
    );
  }

  revalidatePath("/app/contactos");
  return { ok: true, resumen: partes.join(" · ") };
}

export async function borrarContacto(
  negocioId: string,
  contactoId: string,
): Promise<EstadoContacto> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const db = scoped(negocioId);

  /*
   * Borrar un contacto se lleva por cascada sus conversaciones y sus mensajes.
   * Es lo correcto para el derecho de supresión del RGPD —«bórrame»— pero
   * significa que esto no es «quitarlo de una lista»: es borrar su historial.
   * Quien llama tiene que haberlo confirmado.
   */
  const { error } = await db.from("contacts").delete().eq("id", contactoId);

  if (error) {
    console.error("[contactos] no se pudo borrar", error.message);
    return { error: "No se pudo borrar." };
  }

  await db.from("events").insert({
    type: "contact.deleted",
    actor: "human",
    payload: {},
  });

  revalidatePath("/app/contactos");
  return { ok: true };
}
