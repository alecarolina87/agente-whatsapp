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
      "id, name, slug, ia_activa, tope_mensual_usd, buffer_segundos, channels(phone_number, status, system_prompt)",
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
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Su agente
        </h2>

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Espera antes de contestar</dt>
            <dd className="dato">{data.buffer_segundos} s</dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Cómo se comporta</p>
          <p className="mt-1.5 text-sm whitespace-pre-wrap">
            {canal?.system_prompt || (
              <span className="text-muted-foreground">
                Sin instrucciones propias todavía: usa las reglas por defecto de la
                plataforma.
              </span>
            )}
          </p>
        </div>
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
