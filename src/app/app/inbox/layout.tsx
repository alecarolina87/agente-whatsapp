import { redirect } from "next/navigation";

import { ContadorPestana } from "@/components/inbox/ContadorPestana";
import { ListaConversaciones } from "@/components/inbox/ListaConversaciones";
import { ListaEnVivo } from "@/components/inbox/ListaEnVivo";
import { contarConversaciones, listarConversaciones } from "@/lib/data/inbox";
import { negocioActual } from "@/lib/data/negocios";
import { necesitaPersona } from "@/lib/data/inbox-tipos";

export const metadata = { title: "Inbox · Agente de WhatsApp" };

/**
 * Dos paneles: la lista a la izquierda, la conversación a la derecha.
 *
 * La lista vive en el layout y no en la página para que **no se vuelva a pintar
 * al cambiar de conversación**. Si estuviera dentro de la página, cada clic
 * perdería la posición del scroll —molesto con veinte conversaciones,
 * inaceptable con doscientas— y además reiniciaría el buscador y el filtro en
 * cuanto abrieras uno de los resultados, que es justo cuando los necesitas.
 */
export default async function LayoutInbox({
  children,
}: {
  children: React.ReactNode;
}) {
  const negocio = await negocioActual();

  // Sin negocio no hay bandeja que enseñar: se manda a crearlo en vez de
  // dejar una pantalla vacía que no dice qué hacer.
  if (!negocio) redirect("/app/negocios");

  const [conversaciones, total] = await Promise.all([
    listarConversaciones(negocio.id),
    contarConversaciones(negocio.id),
  ]);

  /*
   * El contador de la pestaña cuenta sobre **todas** las cargadas, no sobre lo
   * que deje ver el filtro. Un filtro es una forma de mirar; el número del
   * título del navegador tiene que seguir diciendo cuánta gente espera, aunque
   * en ese momento estés mirando otra cosa.
   */
  const esperando = conversaciones.filter(necesitaPersona);

  return (
    <div className="grid h-[calc(100dvh-8rem)] grid-cols-1 overflow-hidden rounded-[var(--radius-card)] border border-border md:grid-cols-[320px_1fr]">
      <ContadorPestana
        cuantas={esperando.length}
        base="Inbox · Agente de WhatsApp"
      />

      <aside className="flex flex-col overflow-hidden border-b border-border md:border-r md:border-b-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Conversaciones
          </p>
          <span className="dato text-xs text-muted-foreground">{total}</span>
        </div>

        <ListaEnVivo workspaceId={negocio.id} />

        <ListaConversaciones conversaciones={conversaciones} total={total} />
      </aside>

      <section className="overflow-hidden">{children}</section>
    </div>
  );
}
