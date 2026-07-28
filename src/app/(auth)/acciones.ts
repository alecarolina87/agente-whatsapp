"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

/**
 * Acciones de autenticación.
 *
 * La validación va aquí, en el servidor, no solo en el formulario: lo que se
 * comprueba en el navegador es comodidad para quien escribe, no seguridad.
 * Cualquiera puede saltarse el HTML y llamar directamente.
 */

const credenciales = z.object({
  email: z.email({ message: "Escribe un correo válido." }),
  password: z
    .string()
    .min(8, { message: "La contraseña necesita al menos 8 caracteres." }),
});

export type EstadoAuth = { error?: string } | undefined;

export async function iniciarSesion(
  _estadoPrevio: EstadoAuth,
  formData: FormData,
): Promise<EstadoAuth> {
  const resultado = credenciales.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!resultado.success) {
    return { error: resultado.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(resultado.data);

  if (error) {
    // A propósito no se distingue entre "ese correo no existe" y "la contraseña
    // no es esa": decirlo permitiría averiguar qué correos están registrados.
    return { error: "El correo o la contraseña no son correctos." };
  }

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function registrarse(
  _estadoPrevio: EstadoAuth,
  formData: FormData,
): Promise<EstadoAuth> {
  const resultado = credenciales.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!resultado.success) {
    return { error: resultado.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(resultado.data);

  if (error) {
    return { error: error.message };
  }

  redirect("/entrar?registro=ok");
}

export async function cerrarSesion() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/entrar");
}
