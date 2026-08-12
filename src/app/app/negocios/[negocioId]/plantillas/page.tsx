import Link from "next/link";
import { notFound } from "next/navigation";

import { Plantillas } from "@/components/negocios/Plantillas";
import { listarPlantillasDelNegocio } from "@/lib/data/plantillas";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Plantillas · Agente de WhatsApp" };

type FilaNegocio = {
  id: string;
  name: string;
  channels: { status: string }[] | null;
};

/**
 * Las plantillas de un negocio.
 *
 * Es la pantalla que desbloquea el caso de uso que más piden las clínicas:
 * recordar una cita al día siguiente. Sin plantillas aprobadas, Meta no deja
 * escribir a nadie que lleve más de 24 h sin contestar — ni al agente ni a una
 * persona.
 */
export default async function PaginaPlantillas({
  params,
}: {
  params: Promise<{ negocioId: string }>;
}) {
  const { negocioId } = await params;
  const supabase = await createClient();

  // Con la sesión de quien pide: si el negocio no es suyo, RLS no lo devuelve.
  const { data } = await supabase
    .from("workspaces")
    .select("id, name, channels(status)")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<FilaNegocio, { merge: false }>();

  if (!data) notFound();

  const plantillas = await listarPlantillasDelNegocio(data.id);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href={`/app/negocios/${data.id}`}
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {data.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Plantillas</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          WhatsApp solo deja escribir libremente durante 24 h desde el último
          mensaje del cliente. Pasado ese plazo, esto es lo único que se puede
          enviar — y tiene que aprobarlo Meta antes.
        </p>
      </div>

      <Plantillas
        negocioId={data.id}
        plantillas={plantillas}
        conectado={data.channels?.[0]?.status === "active"}
      />
    </div>
  );
}
