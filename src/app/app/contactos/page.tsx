import Link from "next/link";
import { notFound } from "next/navigation";

import { ListaContactos } from "@/components/contactos/ListaContactos";
import { POR_PAGINA, listarContactos } from "@/lib/data/contactos";
import { negocioActual } from "@/lib/data/negocios";

export const metadata = { title: "Contactos · Agente de WhatsApp" };

/**
 * Los contactos del negocio que esté seleccionado arriba.
 *
 * Va en `/app/contactos` y no dentro de `/app/negocios/[id]/` a propósito: esto
 * es operación diaria, como la bandeja, no configuración. Se cambia de negocio
 * con el mismo selector de la cabecera.
 */
export default async function PaginaContactos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const { q, p } = await searchParams;

  const negocio = await negocioActual();
  if (!negocio) notFound();

  const pagina = Math.max(0, Number(p ?? 0) || 0);
  const busqueda = q ?? "";

  const { contactos, total, sinConsentimiento } = await listarContactos(
    negocio.id,
    {
      busqueda,
      pagina,
    },
  );

  const hayMas = (pagina + 1) * POR_PAGINA < total;
  const enlace = (n: number) =>
    `/app/contactos?${new URLSearchParams({
      ...(busqueda ? { q: busqueda } : {}),
      ...(n > 0 ? { p: String(n) } : {}),
    })}`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contactos</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          De {negocio.nombre}. Quien escribe por WhatsApp entra solo y con
          consentimiento; los importados hay que declararlos.
        </p>
      </div>

      <ListaContactos
        negocioId={negocio.id}
        contactos={contactos}
        total={total}
        sinConsentimiento={sinConsentimiento}
        busqueda={busqueda}
      />

      {(pagina > 0 || hayMas) && (
        <div className="flex items-center justify-between">
          {pagina > 0 ? (
            <Link
              href={enlace(pagina - 1)}
              className="dato text-xs text-muted-foreground transition hover:text-foreground"
            >
              ← Anteriores
            </Link>
          ) : (
            <span />
          )}

          <span className="dato text-xs text-muted-foreground">
            {pagina * POR_PAGINA + 1}–
            {Math.min((pagina + 1) * POR_PAGINA, total)} de {total}
          </span>

          {hayMas ? (
            <Link
              href={enlace(pagina + 1)}
              className="dato text-xs text-muted-foreground transition hover:text-foreground"
            >
              Siguientes →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
