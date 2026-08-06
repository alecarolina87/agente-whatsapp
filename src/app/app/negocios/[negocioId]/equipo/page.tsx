import Link from "next/link";
import { notFound } from "next/navigation";

import { FormularioEquipo } from "@/components/negocios/FormularioEquipo";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Equipo · Agente de WhatsApp" };

type FilaMiembro = {
  user_id: string;
  email: string | null;
  role: string;
  created_at: string;
};

/**
 * Quién puede entrar al panel de este negocio.
 *
 * Es lo que convierte la plataforma en algo que se vende: hasta ahora el
 * cliente no podía ver sus propias conversaciones, y toda la arquitectura
 * multi-tenant de F0 estaba construida sin usarse.
 */
export default async function PaginaEquipo({
  params,
}: {
  params: Promise<{ negocioId: string }>;
}) {
  const { negocioId } = await params;
  const supabase = await createClient();

  const { data: negocio } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  if (!negocio) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * Los correos viven en `auth.users`, que no se consulta desde la API. La
   * vista `equipo_del_negocio` los expone heredando el RLS de
   * `workspace_members`: solo salen los equipos de los que uno es miembro.
   */
  const { data: miembros } = await supabase
    .from("equipo_del_negocio")
    .select("user_id, email, role, created_at")
    .eq("workspace_id", negocioId)
    .order("created_at", { ascending: true })
    .overrideTypes<FilaMiembro[], { merge: false }>();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href={`/app/negocios/${negocio.id}`}
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {negocio.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Equipo</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Quién puede entrar al panel de {negocio.name}. Cada persona ve solo
          este negocio, nunca los demás.
        </p>
      </div>

      <FormularioEquipo
        negocioId={negocio.id}
        yoSoy={user?.id ?? null}
        miembros={(miembros ?? []).map((m) => ({
          userId: m.user_id,
          correo: m.email ?? "(sin correo)",
          rol: m.role,
          desde: m.created_at,
        }))}
      />
    </div>
  );
}
