import Link from "next/link";

import { listarNegocios } from "@/lib/data/negocios";

export const metadata = { title: "Mis negocios · Agente de WhatsApp" };

/**
 * La portada de la agencia: todos los clientes y cómo van.
 *
 * Está pensada para el vistazo de treinta segundos, no para el estudio: lo que
 * se ve primero es **quién necesita atención**. Un cliente cuyo canal no está
 * conectado no está atendiendo a nadie aunque parezca dado de alta, y un
 * cliente con la IA apagada tampoco — las dos cosas se dicen aquí, en rojo o
 * ámbar, y no escondidas en su ficha.
 */
export default async function PaginaNegocios() {
  const negocios = await listarNegocios();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mis negocios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {negocios.length === 0
              ? "Todavía no llevas ninguno."
              : negocios.length === 1
                ? "Llevas 1 negocio."
                : `Llevas ${negocios.length} negocios.`}
          </p>
        </div>

        <Link
          href="/app/negocios/nuevo"
          className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm text-primary-foreground transition hover:opacity-90"
        >
          Dar de alta un negocio
        </Link>
      </div>

      {negocios.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium">Empieza dando de alta tu primer negocio.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Un negocio es un cliente tuyo: su número de WhatsApp, su agente con su
            personalidad, y sus conversaciones separadas de las de los demás.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {negocios.map((n) => (
            <li key={n.id}>
              <Link
                href={`/app/negocios/${n.id}`}
                className="block rounded-[var(--radius-card)] border border-border bg-card/60 p-5 transition hover:border-primary/40 hover:bg-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{n.nombre}</p>
                    <p className="dato mt-0.5 text-xs text-muted-foreground">
                      {n.canal?.telefono ?? "sin número"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {n.esperando > 0 && (
                      <span className="dato rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning">
                        {n.esperando} te {n.esperando === 1 ? "espera" : "esperan"}
                      </span>
                    )}

                    {/* Un canal sin conectar no recibe nada. Es el fallo más
                        caro de todos porque desde fuera parece que funciona. */}
                    {n.canal?.estado !== "active" && (
                      <span className="dato rounded-full bg-destructive/15 px-2.5 py-1 text-xs text-destructive">
                        WhatsApp sin conectar
                      </span>
                    )}

                    <span
                      className={`dato rounded-full px-2.5 py-1 text-xs ${
                        n.iaActiva
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {n.iaActiva ? "IA activa" : "IA en pausa"}
                    </span>
                  </div>
                </div>

                <div className="dato mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {n.abiertas} {n.abiertas === 1 ? "conversación" : "conversaciones"}
                  </span>
                  <span>
                    {/* Cuatro decimales porque una respuesta cuesta ~0,0006 $:
                        con dos, todo el trabajo del mes se vería como 0,00. */}
                    {n.gastado.toFixed(4)} $ este mes
                    {n.topeMensualUsd ? ` de ${n.topeMensualUsd} $` : ""}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
