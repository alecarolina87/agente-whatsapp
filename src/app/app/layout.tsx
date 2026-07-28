import { redirect } from "next/navigation";

import { cerrarSesion } from "../(auth)/acciones";
import { createClient } from "@/lib/supabase/server";

/**
 * Área privada.
 *
 * La comprobación se hace con `getUser()`, que valida el token contra Supabase.
 * No vale mirar la sesión de la cookie: esa la puede falsificar cualquiera desde
 * el navegador.
 */
export default async function LayoutApp({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/entrar");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3.5">
        <p className="text-sm font-semibold tracking-[0.16em] text-primary uppercase">
          Agente de WhatsApp
        </p>

        <div className="flex items-center gap-4">
          <span className="dato text-sm text-muted-foreground">{user.email}</span>
          <form action={cerrarSesion}>
            <button
              type="submit"
              className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm transition hover:bg-muted"
            >
              Salir
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
