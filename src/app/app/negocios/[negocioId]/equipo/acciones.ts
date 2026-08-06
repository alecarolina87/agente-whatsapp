"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Dar acceso a alguien al panel de un negocio.
 *
 * ## Sin correos de invitación, y es deliberado
 *
 * Lo habitual sería mandar un email con un enlace. Eso obliga a montar un
 * servidor de correo, a pelearse con el spam y a que el cliente encuentre el
 * mensaje. Tres cosas que fallan, y cuando fallan el cliente no entra y hay que
 * llamarle por teléfono.
 *
 * Aquí la cuenta se crea en el momento con una contraseña, y se enseña **una
 * sola vez** para copiarla. Se la pasas al cliente por donde ya estás hablando
 * con él. Cero infraestructura.
 *
 * ## Por qué hace falta la clave de servicio
 *
 * Crear un usuario de Supabase es una operación de administración. Va con el
 * patrón de las dos llaves: primero se comprueba con la sesión de quien pide
 * que sea admin de ese negocio, y solo después se usa la clave que puede.
 */

export type ResultadoInvitacion =
  | { ok: true; correo: string; contrasena: string | null; yaTenia: boolean }
  | { ok: false; error: string };

const invitacion = z.object({
  correo: z.string().trim().toLowerCase().email("Ese correo no parece válido"),
  rol: z.enum(["admin", "manager", "agent", "viewer"]),
});

/** `true` solo si quien pide es admin de este negocio. */
async function esAdmin(negocioId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", negocioId)
    .eq("user_id", user.id)
    .maybeSingle()
    .overrideTypes<{ role: string }, { merge: false }>();

  return data?.role === "admin";
}

/**
 * Contraseña legible pero fuerte.
 *
 * Se va a dictar por WhatsApp o por teléfono, así que sin caracteres que se
 * confundan al leerlos —ni l, ni I, ni 0, ni O— y en grupos de cuatro. Con 24
 * caracteres de este alfabeto sobra entropía de sobra.
 */
function generarContrasena(): string {
  const alfabeto = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(24);
  const letras = [...bytes].map((b) => alfabeto[b % alfabeto.length]);

  return [0, 6, 12, 18].map((i) => letras.slice(i, i + 6).join("")).join("-");
}

export async function darAcceso(
  negocioId: string,
  _previo: ResultadoInvitacion | null,
  formData: FormData,
): Promise<ResultadoInvitacion> {
  if (!(await esAdmin(negocioId))) {
    return { ok: false, error: "Solo un admin puede dar acceso a este negocio." };
  }

  const datos = invitacion.safeParse({
    correo: formData.get("correo"),
    rol: formData.get("rol") ?? "agent",
  });

  if (!datos.success) return { ok: false, error: datos.error.issues[0].message };

  const { correo, rol } = datos.data;
  const admin = createAdminClient();

  /*
   * ¿Ya tiene cuenta? Puede ser alguien que trabaja en dos negocios tuyos, o el
   * propio administrador de la agencia. En ese caso no se toca su contraseña:
   * cambiársela le echaría de sus otras sesiones sin avisar.
   */
  const { data: existentes } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const yaExiste = existentes?.users.find((u) => u.email?.toLowerCase() === correo);

  let userId = yaExiste?.id ?? null;
  let contrasena: string | null = null;

  if (!userId) {
    contrasena = generarContrasena();

    const { data: creado, error } = await admin.auth.admin.createUser({
      email: correo,
      password: contrasena,
      // Sin confirmación por correo: no hay servidor de correo montado, y el
      // acceso lo da quien crea la cuenta, no un enlace.
      email_confirm: true,
    });

    if (error || !creado.user) {
      console.error("[equipo] no se pudo crear la cuenta", error?.message);
      return { ok: false, error: "No se pudo crear la cuenta. Inténtalo otra vez." };
    }

    userId = creado.user.id;
  }

  // El permiso lo da la función de la base de datos, que vuelve a comprobar que
  // quien llama es admin. Dos comprobaciones para lo mismo, a propósito.
  const supabase = await createClient();
  const { error } = await supabase.rpc("agregar_al_equipo", {
    p_workspace_id: negocioId,
    p_user_id: userId,
    p_rol: rol,
  });

  if (error) {
    console.error("[equipo] no se pudo dar acceso", error.message);
    return { ok: false, error: "No se pudo dar acceso. Inténtalo otra vez." };
  }

  revalidatePath("/app", "layout");

  return { ok: true, correo, contrasena, yaTenia: Boolean(yaExiste) };
}

export async function quitarAcceso(
  negocioId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  /*
   * Aquí no hace falta comprobar el rol a mano: `quitar_del_equipo` lo hace, y
   * además impide quitar al último admin — un negocio sin nadie que lo gestione
   * solo se arregla entrando a la base de datos.
   */
  const { error } = await supabase.rpc("quitar_del_equipo", {
    p_workspace_id: negocioId,
    p_user_id: userId,
  });

  if (error) {
    // Los mensajes de estas funciones están escritos para leerse.
    return { ok: false, error: error.message };
  }

  revalidatePath("/app", "layout");
  return { ok: true };
}
