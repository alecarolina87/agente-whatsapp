import Link from "next/link";
import { notFound } from "next/navigation";

import { FormularioInfo } from "@/components/negocios/FormularioInfo";
import { createClient } from "@/lib/supabase/server";

import type { Ficha } from "./acciones";

export const metadata = { title: "Información del negocio · Agente de WhatsApp" };

type FilaFicha = {
  texto_libre: string | null;
  descripcion: string | null;
  horarios: string | null;
  direccion: string | null;
  zona: string | null;
  web: string | null;
  no_prometer: string | null;
  servicios: Ficha["servicios"] | null;
  faqs: Ficha["faqs"] | null;
  objeciones: Ficha["objeciones"] | null;
};

export default async function PaginaInfo({
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

  /*
   * Puede no existir: la ficha es opcional y se crea al guardar por primera vez.
   *
   * Se nombran las columnas en vez de `*` para que quitar una de la tabla
   * rompa aquí, en la compilación, y no en silencio al pintar la pantalla.
   */
  const { data: ficha } = await supabase
    .from("business_info")
    .select(
      "texto_libre, descripcion, horarios, direccion, zona, web, no_prometer, servicios, faqs, objeciones",
    )
    .eq("workspace_id", negocioId)
    .maybeSingle()
    .overrideTypes<FilaFicha, { merge: false }>();

  const inicial: Ficha = {
    texto_libre: ficha?.texto_libre ?? "",
    descripcion: ficha?.descripcion ?? "",
    horarios: ficha?.horarios ?? "",
    direccion: ficha?.direccion ?? "",
    zona: ficha?.zona ?? "",
    web: ficha?.web ?? "",
    no_prometer: ficha?.no_prometer ?? "",
    servicios: ficha?.servicios ?? [],
    faqs: ficha?.faqs ?? [],
    objeciones: ficha?.objeciones ?? [],
  };

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
          Lo que el agente sabe
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Esto es distinto de cómo habla. Aquí van los datos: qué ofrece, cuánto
          cuesta, qué contestar. El tono se escribe en{" "}
          <Link
            href={`/app/negocios/${negocio.id}/probar`}
            className="text-primary hover:underline"
          >
            probar el agente
          </Link>
          .
        </p>
      </div>

      <FormularioInfo negocioId={negocio.id} inicial={inicial} />
    </div>
  );
}
