import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Inicio · Agente de WhatsApp" };

/**
 * Portada del área privada. De momento solo confirma que la sesión funciona y
 * muestra el estado de F0; el inbox llega en F1.
 */
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
    .select("id, name, slug");

  const fases = [
    { id: "F0", nombre: "Foundations", hecho: true },
    { id: "F1", nombre: "MVP: mensaje real → respuesta de IA", hecho: false },
    { id: "F2", nombre: "Buffer inteligente", hecho: false },
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
