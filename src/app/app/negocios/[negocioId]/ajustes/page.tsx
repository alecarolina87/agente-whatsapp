import Link from "next/link";
import { notFound } from "next/navigation";

import { FormularioAjustes } from "@/components/negocios/FormularioAjustes";
import { FormularioClaves } from "@/components/negocios/FormularioClaves";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Ajustes · Agente de WhatsApp" };

type FilaNegocio = {
  id: string;
  name: string;
  buffer_segundos: number;
  mensajes_de_contexto: number;
  tope_mensual_usd: number | null;
  tope_respuestas_hora: number;
  channels:
    | { phone_number: string; status: string; system_prompt: string | null; respuesta_a_archivos: string }[]
    | null;
};

export default async function PaginaAjustes({
  params,
}: {
  params: Promise<{ negocioId: string }>;
}) {
  const { negocioId } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("workspaces")
    .select(
      "id, name, buffer_segundos, mensajes_de_contexto, tope_mensual_usd, tope_respuestas_hora, " +
        "channels(phone_number, status, system_prompt, respuesta_a_archivos)",
    )
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<FilaNegocio, { merge: false }>();

  if (!data) notFound();

  const canal = data.channels?.[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href={`/app/negocios/${data.id}`}
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {data.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Todo lo que cambies aquí afecta solo a este negocio.
        </p>
      </div>

      <FormularioClaves
        negocioId={data.id}
        conectado={canal?.status === "active"}
        telefono={canal?.phone_number ?? null}
      />

      <FormularioAjustes
        negocioId={data.id}
        inicial={{
          nombre: data.name,
          systemPrompt: canal?.system_prompt ?? "",
          respuestaArchivos: canal?.respuesta_a_archivos ?? "",
          bufferSegundos: data.buffer_segundos,
          mensajesDeContexto: data.mensajes_de_contexto,
          topeMensualUsd: data.tope_mensual_usd,
          topeRespuestasHora: data.tope_respuestas_hora,
        }}
      />
    </div>
  );
}
