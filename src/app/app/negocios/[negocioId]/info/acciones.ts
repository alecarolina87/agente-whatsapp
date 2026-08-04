"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";

/**
 * Guardar la ficha del negocio.
 *
 * Todo es opcional a propósito. Quien da de alta un cliente a las once de la
 * noche no rellena quince casillas: si el formulario exigiera, lo dejaría a
 * medias y no guardaría nada. Con todo opcional, se guarda lo que haya y se
 * completa otro día.
 */

export type EstadoInfo = { error?: string; guardado?: boolean };

const servicio = z.object({
  nombre: z.string().trim().max(120).default(""),
  descripcion: z.string().trim().max(400).default(""),
  precio: z.string().trim().max(60).default(""),
  duracion: z.string().trim().max(60).default(""),
});

const faq = z.object({
  pregunta: z.string().trim().max(300).default(""),
  respuesta: z.string().trim().max(1200).default(""),
});

const objecion = z.object({
  objecion: z.string().trim().max(300).default(""),
  respuesta: z.string().trim().max(1200).default(""),
});

const ficha = z.object({
  texto_libre: z.string().trim().max(8000).default(""),
  descripcion: z.string().trim().max(2000).default(""),
  horarios: z.string().trim().max(500).default(""),
  direccion: z.string().trim().max(300).default(""),
  zona: z.string().trim().max(200).default(""),
  web: z.string().trim().max(300).default(""),
  no_prometer: z.string().trim().max(2000).default(""),
  servicios: z.array(servicio).max(50).default([]),
  faqs: z.array(faq).max(50).default([]),
  objeciones: z.array(objecion).max(50).default([]),
});

export type Ficha = z.infer<typeof ficha>;

/** Devuelve `true` solo si quien pide puede gestionar este negocio. */
async function puedeGestionar(negocioId: string) {
  const supabase = await createClient();

  // Con una escritura inocua, no con un `select`: ver un negocio y poder
  // cambiarlo son permisos distintos, y el `select` diría que sí a los dos.
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

/** Quita de las listas las filas que se quedaron en blanco. */
function limpiar(f: Ficha) {
  return {
    ...f,
    /*
     * Una fila vacía no es dato, es una casilla que alguien abrió y no llenó.
     * Guardarlas ensucia la ficha y, peor, el prompt: el modelo las lee como
     * servicios sin nombre.
     */
    servicios: f.servicios.filter((s) => s.nombre),
    faqs: f.faqs.filter((x) => x.pregunta && x.respuesta),
    objeciones: f.objeciones.filter((x) => x.objecion && x.respuesta),
  };
}

export async function guardarFicha(
  negocioId: string,
  datos: Ficha,
): Promise<EstadoInfo> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const validada = ficha.safeParse(datos);
  if (!validada.success) return { error: validada.error.issues[0].message };

  const f = limpiar(validada.data);
  const db = scoped(negocioId);

  /*
   * `upsert` sobre `workspace_id`, que es la clave primaria: la ficha puede no
   * existir todavía —es opcional— y no queremos dos caminos distintos según si
   * es la primera vez o no.
   */
  const { error } = await db.from("business_info").upsert(
    {
      texto_libre: f.texto_libre || null,
      descripcion: f.descripcion || null,
      horarios: f.horarios || null,
      direccion: f.direccion || null,
      zona: f.zona || null,
      web: f.web || null,
      no_prometer: f.no_prometer || null,
      servicios: f.servicios,
      faqs: f.faqs,
      objeciones: f.objeciones,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );

  if (error) {
    console.error("[info-negocio] no se pudo guardar", error.message);
    return { error: "No se pudo guardar. Inténtalo otra vez." };
  }

  await db.from("events").insert({
    type: "business_info.updated",
    actor: "human",
    // Cuánto hay, no qué dice: la ficha lleva precios y condiciones, y `events`
    // se consulta con menos cuidado que la tabla.
    payload: {
      servicios: f.servicios.length,
      faqs: f.faqs.length,
      objeciones: f.objeciones.length,
      con_texto_libre: Boolean(f.texto_libre),
    },
  });

  revalidatePath("/app", "layout");
  return { guardado: true };
}
