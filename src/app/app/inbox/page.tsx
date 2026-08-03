import Link from "next/link";

import { listarConversaciones } from "@/lib/data/inbox";
import { negocioActual } from "@/lib/data/negocios";
import { necesitaPersona } from "@/lib/data/inbox-tipos";

/**
 * Lo que se ve al entrar en la bandeja, antes de elegir conversación.
 *
 * Es la primera pantalla del repaso que Ale hace entre clienta y clienta, así
 * que no puede limitarse a decir «elige una de la izquierda»: tiene que
 * responder a la pregunta con la que entra, que es *¿me espera alguien?*.
 */
export default async function InboxSinSeleccion() {
  const negocio = await negocioActual();
  const conversaciones = negocio ? await listarConversaciones(negocio.id) : [];
  const esperando = conversaciones.filter(necesitaPersona);

  if (esperando.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">Nadie espera respuesta.</p>
        <p className="text-xs text-muted-foreground">
          {conversaciones.length > 0
            ? "El agente lleva las conversaciones abiertas. Elige una de la izquierda para leerla."
            : "Cuando llegue un WhatsApp, aparecerá a la izquierda."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <p className="text-sm font-medium text-warning">
          {esperando.length === 1
            ? "Hay 1 conversación esperándote."
            : `Hay ${esperando.length} conversaciones esperándote.`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          El agente no va a contestarlas. Están arriba del todo, marcadas.
        </p>
      </div>

      {/* Un atajo a la primera: en el repaso rápido, un clic menos importa. */}
      <Link
        href={`/app/inbox/${esperando[0].id}`}
        className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm text-primary-foreground transition hover:opacity-90"
      >
        Abrir la de {esperando[0].contacto.nombre ?? esperando[0].contacto.telefono}
      </Link>
    </div>
  );
}
