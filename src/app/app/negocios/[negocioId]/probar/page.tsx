import Link from "next/link";
import { notFound } from "next/navigation";

import { ChatDePrueba } from "@/components/negocios/ChatDePrueba";
import { EditorPrompt } from "@/components/negocios/EditorPrompt";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Probar el agente · Agente de WhatsApp" };

type FilaNegocio = {
  id: string;
  name: string;
  channels: { system_prompt: string | null }[] | null;
};

/**
 * Escribir la personalidad del agente y probarla al lado.
 *
 * Las dos cosas en la misma pantalla no es una decisión estética: sin esto,
 * ajustar un agente significaba escribir a ciegas y esperar a que llegara un
 * mensaje real para ver el efecto. El ciclo pasaba de horas a segundos.
 */
export default async function PaginaProbar({
  params,
}: {
  params: Promise<{ negocioId: string }>;
}) {
  const { negocioId } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("workspaces")
    .select("id, name, channels(system_prompt)")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<FilaNegocio, { merge: false }>();

  if (!data) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <Link
          href={`/app/negocios/${data.id}`}
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {data.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Probar el agente</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Cambia las instrucciones a la izquierda, guarda, y pregúntale a la
          derecha. No se manda ningún WhatsApp ni queda nada en la bandeja: lo
          único que gastas son los tokens del modelo, y se ven debajo de cada
          respuesta.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <EditorPrompt negocioId={data.id} inicial={data.channels?.[0]?.system_prompt ?? ""} />
        <ChatDePrueba negocioId={data.id} />
      </div>
    </div>
  );
}
