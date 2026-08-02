import Link from "next/link";

import { ContadorPestana } from "@/components/inbox/ContadorPestana";
import { AvisoHandoff, EstadoVentana } from "@/components/inbox/EstadoVentana";
import { ListaEnVivo } from "@/components/inbox/ListaEnVivo";
import { listarConversaciones, workspaceActual } from "@/lib/data/inbox";
import { necesitaPersona, type ConversacionListada } from "@/lib/data/inbox-tipos";

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

  /*
   * Las que esperan a una persona van arriba, en su propio grupo.
   *
   * Ale no está delante del ordenador cuando llegan los mensajes: entra a
   * mirar entre clienta y clienta. En una lista ordenada solo por fecha, la
   * que necesita respuesta puede quedar la cuarta, con la misma pinta que el
   * resto — y en ese repaso de dos minutos se pasa por alto.
   */
  const esperando = conversaciones.filter(necesitaPersona);
  const alDia = conversaciones.filter((c) => !necesitaPersona(c));

  return (
    <div className="grid h-[calc(100dvh-8rem)] grid-cols-1 overflow-hidden rounded-[var(--radius-card)] border border-border md:grid-cols-[320px_1fr]">
      <ContadorPestana cuantas={esperando.length} base="Inbox · Agente de WhatsApp" />

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

          {esperando.length > 0 && (
            <>
              <Encabezado texto="Te esperan a ti" cuantas={esperando.length} urgente />
              <ul>
                {esperando.map((c) => (
                  <FilaConversacion key={c.id} c={c} destacada />
                ))}
              </ul>
            </>
          )}

          {alDia.length > 0 && (
            <>
              {/* El segundo encabezado solo aparece si hay algo en el primero:
                  con todo al día, una lista a secas se lee mejor. */}
              {esperando.length > 0 && (
                <Encabezado texto="Las lleva el agente" cuantas={alDia.length} />
              )}
              <ul>
                {alDia.map((c) => (
                  <FilaConversacion key={c.id} c={c} />
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>

      <section className="overflow-hidden">{children}</section>
    </div>
  );
}

function Encabezado({
  texto,
  cuantas,
  urgente = false,
}: {
  texto: string;
  cuantas: number;
  urgente?: boolean;
}) {
  return (
    <p
      className={`dato sticky top-0 z-10 flex items-center justify-between px-4 py-2 text-[11px] tracking-[0.14em] uppercase backdrop-blur ${
        urgente ? "bg-warning/15 text-warning" : "bg-background/90 text-muted-foreground"
      }`}
    >
      {texto}
      <span>{cuantas}</span>
    </p>
  );
}

function FilaConversacion({
  c,
  destacada = false,
}: {
  c: ConversacionListada;
  destacada?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/app/inbox/${c.id}`}
        className={`block border-b border-border px-4 py-3 transition hover:bg-muted/60 ${
          // Una línea de color a la izquierda: se distingue de un vistazo sin
          // repintar la fila entera, que cansaría con veinte esperando.
          destacada ? "border-l-2 border-l-warning bg-warning/5" : ""
        }`}
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

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {c.estado === "handoff_pending" && <AvisoHandoff compacto />}
          <EstadoVentana caducaEn={c.ventanaCaducaEn} compacto />
          {!c.iaActiva && (
            <span className="dato text-[11px] text-muted-foreground">IA en pausa</span>
          )}
        </div>
      </Link>
    </li>
  );
}
