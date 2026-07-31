import Link from "next/link";

import { PanelDeControl } from "@/components/PanelDeControl";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Inicio · Agente de WhatsApp" };

type FilaWorkspace = {
  id: string;
  name: string;
  slug: string;
  ia_activa: boolean;
  tope_mensual_usd: number | null;
};

/** Portada del área privada: el estado del agente y el acceso al inbox. */
export default async function PaginaApp() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Esta consulta pasa por RLS, no por la capa de servidor: devuelve solo los
  // workspaces de los que esta persona es miembro. Si sale vacío, es que aún no
  // pertenece a ninguno — el alta llega con el onboarding.
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, slug, ia_activa, tope_mensual_usd")
    .overrideTypes<FilaWorkspace[], { merge: false }>();

  const principal = workspaces?.[0];

  // El gasto lo suma Postgres. Traerse todos los mensajes del mes para sumarlos
  // aquí funcionaría hoy, con cuatro, y dejaría de funcionar con cuatro mil.
  const { data: gastado } = principal
    ? await supabase.rpc("gasto_del_mes", { p_workspace_id: principal.id })
    : { data: 0 };

  const fases = [
    { id: "F0", nombre: "Foundations", hecho: true },
    { id: "F1", nombre: "MVP: mensaje real → respuesta de IA", hecho: true },
    { id: "F2", nombre: "Inbox en vivo, frenos de gasto", hecho: true },
    { id: "F3", nombre: "Handoff a humano", hecho: false },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sesión iniciada
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Entraste como <span className="dato text-foreground">{user?.email}</span>
        </p>
      </div>

      {principal && (
        <PanelDeControl
          workspaceId={principal.id}
          nombre={principal.name}
          iaActiva={principal.ia_activa}
          gastado={Number(gastado ?? 0)}
          tope={principal.tope_mensual_usd}
        />
      )}

      <Link
        href="/app/inbox"
        className="flex items-center justify-between rounded-[var(--radius-card)] border border-primary/40 bg-primary/10 px-6 py-5 transition hover:bg-primary/15"
      >
        <span>
          <span className="block text-sm font-medium">Inbox</span>
          <span className="block text-sm text-muted-foreground">
            Las conversaciones, en vivo
          </span>
        </span>
        <span className="text-primary">→</span>
      </Link>

      <section className="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Tus workspaces
        </h2>

        {workspaces && workspaces.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {workspaces.map((w) => (
              <li key={w.id} className="flex items-center justify-between text-sm">
                <span>{w.name}</span>
                <span className="dato text-muted-foreground">{w.slug}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Todavía no perteneces a ninguno. Que esto salga vacío es señal de que
            RLS funciona: la base de datos solo devuelve los workspaces de los que
            eres miembro.
          </p>
        )}
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Fases
        </h2>
        <ul className="mt-4 space-y-2.5">
          {fases.map((f) => (
            <li key={f.id} className="flex items-center gap-3 text-sm">
              <span
                className={`dato rounded-full px-2 py-0.5 text-xs ${
                  f.hecho
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {f.id}
              </span>
              <span className={f.hecho ? "" : "text-muted-foreground"}>
                {f.nombre}
              </span>
              {f.hecho && <span className="ml-auto text-xs text-success">listo</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
