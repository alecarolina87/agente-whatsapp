import Link from "next/link";
import { notFound } from "next/navigation";

import { Capacidades } from "@/components/negocios/Capacidades";
import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Capacidades · Agente de WhatsApp" };

type FilaCapacidad = {
  clave: string;
  activa: boolean;
  config: Record<string, string> | null;
};

/**
 * Lo que el agente sabe hacer, además de contestar.
 *
 * Es lo que separa un agente que explica cómo pedir cita de uno que te pasa el
 * enlace en el mismo mensaje, mientras la clienta sigue decidida.
 */
export default async function PaginaCapacidades({
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

  const db = scoped(negocio.id);
  const { data } = await db
    .from("workspace_tools")
    .select("clave, activa, config")
    .overrideTypes<FilaCapacidad[], { merge: false }>();

  const configuradas = Object.fromEntries(
    (data ?? []).map((f) => [
      f.clave,
      { activa: f.activa, config: f.config ?? {} },
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href={`/app/negocios/${negocio.id}`}
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {negocio.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Capacidades
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Lo que el agente puede hacer además de escribir. Cada una necesita su
          configuración: sin ella no se activa, para que no le dé a nadie un
          dato inventado.
        </p>
      </div>

      <Capacidades negocioId={negocio.id} configuradas={configuradas} />
    </div>
  );
}
