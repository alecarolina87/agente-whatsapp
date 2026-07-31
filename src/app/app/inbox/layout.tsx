import Link from "next/link";

import { EstadoVentana } from "@/components/inbox/EstadoVentana";
import { ListaEnVivo } from "@/components/inbox/ListaEnVivo";
import { listarConversaciones, workspaceActual } from "@/lib/data/inbox";

export const metadata = { title: "Inbox · Agente de WhatsApp" };

/**
 * Dos paneles: la lista a la izquierda, la conversación a la derecha.
 *
 * La lista vive en el layout y no en la página para que **no se vuelva a pintar
 * al cambiar de conversación**. Si estuviera dentro de la página, cada clic
 * perdería la posición del scroll — molesto con veinte conversaciones,
 * inaceptable con doscientas.
 */
export default async function LayoutInbox({ children }: { children: React.ReactNode }) {
  const workspace = await workspaceActual();

  if (!workspace) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no perteneces a ningún workspace.
      </p>
    );
  }

  const conversaciones = await listarConversaciones(workspace.id);

  return (
    <div className="grid h-[calc(100dvh-8rem)] grid-cols-1 overflow-hidden rounded-[var(--radius-card)] border border-border md:grid-cols-[320px_1fr]">
      <aside className="flex flex-col overflow-hidden border-b border-border md:border-r md:border-b-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Conversaciones
          </p>
          <span className="dato text-xs text-muted-foreground">{conversaciones.length}</span>
        </div>

        <ListaEnVivo workspaceId={workspace.id} />

        <div className="flex-1 overflow-y-auto">
          {conversaciones.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Aún no ha escrito nadie. Cuando llegue un WhatsApp, aparecerá aquí.
            </p>
          )}

          <ul>
            {conversaciones.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/inbox/${c.id}`}
                  className="block border-b border-border px-4 py-3 transition hover:bg-muted/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {c.contacto.nombre ?? c.contacto.telefono}
                    </p>
                    {c.sinLeer > 0 && (
                      <span className="dato rounded-full bg-primary px-1.5 py-0.5 text-[11px] text-primary-foreground">
                        {c.sinLeer}
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.ultimoTexto ?? "Sin mensajes"}
                  </p>

                  <div className="mt-1.5 flex items-center gap-2">
                    <EstadoVentana caducaEn={c.ventanaCaducaEn} compacto />
                    {!c.iaActiva && (
                      <span className="dato text-[11px] text-muted-foreground">
                        IA en pausa
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="overflow-hidden">{children}</section>
    </div>
  );
}
