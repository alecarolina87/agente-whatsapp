import Link from "next/link";
import { notFound } from "next/navigation";

import { PanelDeControl } from "@/components/PanelDeControl";
import { UrlWebhook } from "@/components/negocios/UrlWebhook";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Negocio · Agente de WhatsApp" };

type FilaNegocio = {
  id: string;
  name: string;
  slug: string;
  ia_activa: boolean;
  tope_mensual_usd: number | null;
  buffer_segundos: number;
  mensajes_de_contexto: number;
  channels: { phone_number: string; status: string; system_prompt: string | null }[] | null;
};

/**
 * La ficha de un cliente.
 *
 * Lo primero que se ve es **la URL de su webhook**, y no es decoración: hasta
 * que esa dirección está pegada en su cuenta de YCloud, el negocio existe en la
 * plataforma pero no recibe ni un mensaje. Es el único paso del alta que no se
 * puede hacer desde aquí, así que es el que tiene que estar más a mano.
 */
export default async function PaginaNegocio({
  params,
  searchParams,
}: {
  params: Promise<{ negocioId: string }>;
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { negocioId } = await params;
  const { nuevo } = await searchParams;

  const supabase = await createClient();

  // Con la sesión de quien pide: si el negocio no es suyo, RLS no lo devuelve
  // y sale un 404. No hace falta comprobar la pertenencia a mano.
  const { data } = await supabase
    .from("workspaces")
    .select(
      "id, name, slug, ia_activa, tope_mensual_usd, buffer_segundos, mensajes_de_contexto, " +
        "channels(phone_number, status, system_prompt)",
    )
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<FilaNegocio, { merge: false }>();

  if (!data) notFound();

  const canal = data.channels?.[0] ?? null;
  const conectado = canal?.status === "active";

  // La suma la hace Postgres: traerse los mensajes del mes para sumarlos aquí
  // funciona con cuatro y deja de funcionar con cuatro mil.
  const { data: gastado } = await supabase.rpc("gasto_del_mes", { p_workspace_id: data.id });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href="/app/negocios"
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← Mis negocios
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{data.name}</h1>
        <p className="dato mt-1 text-sm text-muted-foreground">
          {canal?.phone_number ?? "sin número"} · {data.slug}
        </p>
      </div>

      {nuevo && (
        <p className="rounded-[var(--radius-card)] border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          Negocio creado. Su espacio está aislado del resto desde este momento.
        </p>
      )}

      <UrlWebhook negocioId={data.id} conectado={conectado} />

      {/* El freno de mano, por negocio. Para el agente de este cliente sin
          tocar el de los demás — que es justo lo que se necesita cuando algo
          va mal en uno solo. */}
      <PanelDeControl
        workspaceId={data.id}
        nombre={data.name}
        iaActiva={data.ia_activa}
        gastado={Number(gastado ?? 0)}
        tope={data.tope_mensual_usd}
      />

      <section className="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Cómo habla
          </h2>
          <div className="dato flex gap-4 text-xs">
            <Link
              href={`/app/negocios/${data.id}/probar`}
              className="text-primary transition hover:underline"
            >
              Probar el agente
            </Link>
            <Link
              href={`/app/negocios/${data.id}/ajustes`}
              className="text-muted-foreground transition hover:text-foreground"
            >
              Ajustes
            </Link>
          </div>
        </div>

        <p className="mt-3 text-sm whitespace-pre-wrap">
          {canal?.system_prompt || (
            <span className="text-muted-foreground">
              Sin instrucciones propias todavía: usa las reglas por defecto de la
              plataforma. Escribirlas es lo que más cambia la calidad de las
              respuestas.
            </span>
          )}
        </p>

        <dl className="dato mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            <dt>Espera</dt>
            <dd className="text-foreground">{data.buffer_segundos} s</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Recuerda</dt>
            <dd className="text-foreground">{data.mensajes_de_contexto} mensajes</dd>
          </div>
        </dl>
      </section>

      <Link
        href="/app/inbox"
        className="flex items-center justify-between rounded-[var(--radius-card)] border border-primary/40 bg-primary/10 px-6 py-5 transition hover:bg-primary/15"
      >
        <span>
          <span className="block text-sm font-medium">Ver sus conversaciones</span>
          <span className="block text-sm text-muted-foreground">
            La bandeja de {data.name}
          </span>
        </span>
        <span className="text-primary">→</span>
      </Link>
    </div>
  );
}
