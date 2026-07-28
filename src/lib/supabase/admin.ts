import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con la clave de servicio. **Se salta RLS por completo.**
 *
 * Es necesario para el webhook, el motor del agente y las tareas programadas:
 * ahí no hay una sesión de usuario de la que colgar los permisos.
 *
 * El `import "server-only"` de arriba no es decorativo — hace que la
 * compilación **falle** si alguien importa esto desde un componente de
 * cliente. Sin él, la clave secreta acabaría en el navegador.
 *
 * No usar directamente para leer datos de negocio: para eso está
 * `src/lib/data/scoped.ts`, que obliga a pasar el workspace (§7 del blueprint).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secreta = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secreta) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.",
    );
  }

  return createSupabaseClient(url, secreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
