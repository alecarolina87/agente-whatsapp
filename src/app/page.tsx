import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Portada. No tiene contenido propio: manda al inbox si hay sesión y al login
 * si no la hay. La página pública de la plataforma, cuando exista, irá aparte.
 */
export default async function Inicio() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/app" : "/entrar");
}
