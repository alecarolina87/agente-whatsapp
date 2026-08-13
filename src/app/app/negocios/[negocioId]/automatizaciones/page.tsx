import Link from "next/link";
import { notFound } from "next/navigation";

import { Automatizaciones } from "@/components/negocios/Automatizaciones";
import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Automatizaciones · Agente de WhatsApp" };

type FilaAutomatizacion = {
  id: string;
  nombre: string;
  activa: boolean;
  disparador: string;
  accion: string;
  config_disparador: Record<string, string> | null;
  config_accion: Record<string, string> | null;
};

type FilaPlantilla = {
  id: string;
  name: string;
  body: string;
  variable_count: number;
};

/**
 * Lo que pasa sin que nadie esté delante.
 *
 * El agente contesta muy bien a quien escribe; lo que no sabe es acordarse de
 * quien se quedó a medias. Aquí es donde se le dice que lo haga.
 */
export default async function PaginaAutomatizaciones({
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

  const [{ data: reglas }, { data: plantillas }] = await Promise.all([
    db
      .from("automations")
      .select(
        "id, nombre, activa, disparador, accion, config_disparador, config_accion",
      )
      .order("created_at", { ascending: false })
      .overrideTypes<FilaAutomatizacion[], { merge: false }>(),

    /*
     * Solo las aprobadas. Ofrecer una que Meta todavía está revisando sería
     * dejar montada una automatización que falla el día que salte, y el fallo
     * se vería semanas después en un log que nadie mira.
     */
    db
      .from("templates")
      .select("id, name, body, variable_count")
      .eq("status", "approved")
      .order("name")
      .overrideTypes<FilaPlantilla[], { merge: false }>(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link
          href={`/app/negocios/${negocio.id}`}
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {negocio.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Automatizaciones
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Cosas que pasan solas: recuperar a quien se quedó sin contestar,
          etiquetar a los nuevos. Nacen apagadas y se encienden cuando las hayas
          releído.
        </p>
      </div>

      <Automatizaciones
        negocioId={negocio.id}
        reglas={reglas ?? []}
        plantillas={plantillas ?? []}
      />
    </div>
  );
}
