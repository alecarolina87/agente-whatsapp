import Link from "next/link";
import { redirect } from "next/navigation";

import { cerrarSesion } from "../(auth)/acciones";
import { SelectorNegocio } from "@/components/negocios/SelectorNegocio";
import { listarNegocios, negocioActual } from "@/lib/data/negocios";
import { createClient } from "@/lib/supabase/server";

/**
 * Área privada.
 *
 * La comprobación se hace con `getUser()`, que valida el token contra Supabase.
 * No vale mirar la sesión de la cookie: esa la puede falsificar cualquiera desde
 * el navegador.
 *
 * La cabecera lleva **qué negocio se está mirando**, porque de esa elección
 * cuelga todo lo demás: la bandeja, el gasto, los ajustes. Tenerlo siempre a la
 * vista evita el error caro de contestarle a la clienta del negocio de al lado.
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

  const [negocios, actual] = await Promise.all([listarNegocios(), negocioActual()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3.5">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/app/negocios"
            className="text-sm font-semibold tracking-[0.16em] text-primary uppercase"
          >
            Agente de WhatsApp
          </Link>

          {actual && (
            <SelectorNegocio
              negocios={negocios.map((n) => ({ id: n.id, nombre: n.nombre }))}
              actual={actual.id}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {actual && (
            <Link
              href="/app/inbox"
              className="text-sm text-muted-foreground transition hover:text-foreground"
            >
              Bandeja
            </Link>
          )}
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
