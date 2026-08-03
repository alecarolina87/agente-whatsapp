"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { COOKIE_NEGOCIO } from "@/lib/data/negocios";
import { createClient } from "@/lib/supabase/server";

/**
 * Alta de un negocio y cambio entre negocios.
 *
 * El alta la hace **la base de datos**, no este archivo: `crear_negocio()` es
 * una función que crea el workspace, la membresía, el canal y las claves en una
 * transacción. Aquí solo se validan los datos y se traduce el error a algo que
 * se pueda leer en pantalla.
 */

const alta = z.object({
  nombre: z.string().trim().min(2, "El nombre necesita al menos dos letras").max(80),
  telefono: z
    .string()
    .trim()
    .regex(
      /^\+[1-9]\d{7,14}$/,
      "El teléfono va en formato internacional, con el +. Por ejemplo: +34600111222",
    ),
  // Opcionales: un negocio se puede crear hoy y conectar su WhatsApp mañana.
  apiKey: z.string().trim().default(""),
  webhookSecret: z.string().trim().default(""),
  systemPrompt: z.string().trim().max(8000).default(""),
  respuestaArchivos: z.string().trim().max(1000).default(""),
});

export type EstadoAlta = { error?: string };

export async function crearNegocio(
  _previo: EstadoAlta,
  formData: FormData,
): Promise<EstadoAlta> {
  const datos = alta.safeParse({
    nombre: formData.get("nombre"),
    telefono: formData.get("telefono"),
    apiKey: formData.get("apiKey") ?? "",
    webhookSecret: formData.get("webhookSecret") ?? "",
    systemPrompt: formData.get("systemPrompt") ?? "",
    respuestaArchivos: formData.get("respuestaArchivos") ?? "",
  });

  if (!datos.success) {
    return { error: datos.error.issues[0].message };
  }

  const { nombre, telefono, apiKey, webhookSecret, systemPrompt, respuestaArchivos } = datos.data;

  /*
   * Las dos claves van juntas o no van. Con una sola, el canal quedaría en un
   * estado que engaña: parecería conectado y no podría ni verificar firmas ni
   * contestar.
   */
  if (Boolean(apiKey) !== Boolean(webhookSecret)) {
    return {
      error:
        "Las dos claves de YCloud van juntas: la API Key y el Webhook Secret. " +
        "O pones las dos, o ninguna y lo conectas más tarde.",
    };
  }

  const supabase = await createClient();

  const { data: workspaceId, error } = await supabase.rpc("crear_negocio", {
    p_nombre: nombre,
    p_telefono: telefono,
    p_ycloud_api_key: apiKey || null,
    p_ycloud_webhook_secret: webhookSecret || null,
    p_system_prompt: systemPrompt || null,
    p_respuesta_a_archivos: respuestaArchivos || null,
  });

  if (error || !workspaceId) {
    // Los `raise exception` de la función traen mensajes escritos para leerse;
    // cualquier otro error de Postgres no, así que se sustituye.
    const suyo = error?.message ?? "";
    const legible =
      suyo.includes("ya está dado de alta") ||
      suyo.includes("formato internacional") ||
      suyo.includes("necesita un nombre") ||
      suyo.includes("iniciar sesión");

    return { error: legible ? suyo : "No se pudo crear el negocio. Inténtalo otra vez." };
  }

  // Recién creado es el que se quiere mirar: se deja elegido antes de redirigir.
  (await cookies()).set(COOKIE_NEGOCIO, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");
  redirect(`/app/negocios/${workspaceId}?nuevo=1`);
}

/** Cambia el negocio que se está mirando. */
export async function elegirNegocio(workspaceId: string) {
  const supabase = await createClient();

  /*
   * Se comprueba que sea suyo antes de guardarlo. La consulta va con la sesión
   * de quien pide, así que si no es miembro no lo encuentra. Sin esto, la
   * cookie guardaría cualquier identificador que le mandaran.
   */
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (!data) return;

  (await cookies()).set(COOKIE_NEGOCIO, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");
}
