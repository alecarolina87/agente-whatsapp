"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { COOKIE_NEGOCIO } from "@/lib/data/negocios";
import { createClient } from "@/lib/supabase/server";
import { leerSecreto } from "@/lib/vault";
import { comprobarCredenciales, comprobarWebhook } from "@/lib/ycloud/verificar";

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

/**
 * Comprueba unas credenciales de YCloud sin guardarlas.
 *
 * La llama el formulario mientras se rellena, para que un error de copiar y
 * pegar salte ahí y no días después, cuando una clienta escriba y no le
 * conteste nadie.
 */
export async function validarClavesYCloud({
  apiKey,
  telefono,
}: {
  apiKey: string;
  telefono?: string;
}): Promise<{ ok: boolean; mensaje: string; numeros?: string[] }> {
  // Hace falta sesión: si no, esto sería un servicio gratuito para que
  // cualquiera comprobase claves de YCloud robadas contra nuestro servidor.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, mensaje: "Hace falta iniciar sesión." };

  const r = await comprobarCredenciales({ apiKey, telefono });

  if (!r.ok) return { ok: false, mensaje: r.motivo };

  const numeros = r.numeros.map((n) => n.telefono);

  /*
   * El caso que de verdad importa: la clave es buena pero el número no es de
   * esa cuenta. Ya pasó una vez en este proyecto y se descubrió por casualidad.
   */
  if (r.coincide === false) {
    return {
      ok: false,
      mensaje:
        `La clave funciona, pero ${telefono} no está en esa cuenta de YCloud. ` +
        `Los números que sí están: ${numeros.join(", ")}.`,
      numeros,
    };
  }

  return {
    ok: true,
    mensaje:
      r.coincide === true
        ? "Todo correcto: la clave funciona y el número está en la cuenta."
        : `La clave funciona. Números en la cuenta: ${numeros.join(", ")}.`,
    numeros,
  };
}

/**
 * Comprueba si la URL de este negocio está pegada en su cuenta de YCloud.
 *
 * Es el único paso del alta que ocurre fuera de la plataforma, y su fallo es
 * silencioso: el mensaje llega a YCloud y se queda ahí, sin error en ninguna
 * parte. Este botón lo convierte en algo que se puede confirmar en el momento,
 * en vez de descubrirlo cuando un cliente llama diciendo que nadie le contestó.
 */
export async function comprobarWebhookDelNegocio(
  negocioId: string,
  urlEsperada: string,
): Promise<{ ok: boolean; mensaje: string }> {
  const supabase = await createClient();

  // Con la sesión de quien pide: si el negocio no es suyo, RLS no lo devuelve.
  const { data: canales } = await supabase
    .from("channels")
    .select("ycloud_credential_ref")
    .eq("workspace_id", negocioId)
    .limit(1)
    .overrideTypes<{ ycloud_credential_ref: string | null }[], { merge: false }>();

  const ref = canales?.[0]?.ycloud_credential_ref;

  if (!ref) {
    return {
      ok: false,
      mensaje: "Primero hay que conectar sus claves de YCloud en los ajustes.",
    };
  }

  const apiKey = await leerSecreto(ref);
  if (!apiKey) return { ok: false, mensaje: "No se encontró su clave de YCloud." };

  const r = await comprobarWebhook({ apiKey, urlEsperada });
  if (!r.ok) return { ok: false, mensaje: r.motivo };

  if (!r.pegado) {
    return {
      ok: false,
      mensaje:
        r.urlesConfiguradas.length > 0
          ? `Su URL no está en YCloud. Lo que sí hay configurado: ${r.urlesConfiguradas.join(", ")}`
          : "Su cuenta de YCloud no tiene ningún webhook configurado. Pega la URL de arriba.",
    };
  }

  /*
   * Pegado y activo son cosas distintas, y aquí ya pasó: el webhook estaba
   * puesto y desactivado a mano, y desde fuera parecía correcto.
   */
  if (!r.activo) {
    return {
      ok: false,
      mensaje: "La URL está pegada pero el webhook está desactivado en YCloud. Actívalo.",
    };
  }

  return { ok: true, mensaje: "La URL está pegada y el webhook está activo." };
}
