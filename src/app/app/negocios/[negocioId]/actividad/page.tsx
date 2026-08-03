import Link from "next/link";
import { notFound } from "next/navigation";

import { metricasDelMes, registroReciente } from "@/lib/data/actividad";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Actividad · Agente de WhatsApp" };

/**
 * Qué ha hecho el agente este mes, y el detalle de por qué.
 *
 * Responde a las dos preguntas que se hacen de verdad: la del cliente —«¿qué me
 * das por lo que te pago?»— y la de quien opera —«¿por qué no contestó a
 * esta?»—. La primera se responde con el número de arriba; la segunda, con el
 * registro de abajo.
 */
export default async function PaginaActividad({
  params,
}: {
  params: Promise<{ negocioId: string }>;
}) {
  const { negocioId } = await params;
  const supabase = await createClient();

  const { data: negocio } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  if (!negocio) notFound();

  const [m, registro] = await Promise.all([
    metricasDelMes(negocioId),
    registroReciente(negocioId),
  ]);

  const porcentajeSolo =
    m.conversaciones > 0 ? Math.round((m.resueltasSolo / m.conversaciones) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link
          href={`/app/negocios/${negocio.id}`}
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {negocio.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Actividad</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Este mes, en {negocio.name}.</p>
      </div>

      {m.conversaciones === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium">Todavía no ha habido conversaciones este mes.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            En cuanto empiece a llegar gente por WhatsApp, aquí verás cuántas
            atendió el agente sin ti y por qué decidió lo que decidió.
          </p>
        </div>
      ) : (
        <>
          {/*
            El número grande es el que justifica la factura. No «cuántos
            mensajes mandó» —eso es volumen— sino cuántas veces evitó que
            alguien tuviera que sentarse a contestar.
          */}
          <section className="rounded-[var(--radius-card)] border border-primary/40 bg-primary/10 p-6">
            <p className="text-sm text-muted-foreground">
              El agente resolvió sin ayuda
            </p>
            <p className="mt-1 text-3xl font-semibold text-primary">
              {m.resueltasSolo} de {m.conversaciones}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {porcentajeSolo}% de las conversaciones.{" "}
              {m.conPersona > 0 && (
                <>
                  {m.conPersona === 1 ? "Una necesitó" : `${m.conPersona} necesitaron`} a una
                  persona.
                </>
              )}
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Dato titulo="Mensajes recibidos" valor={String(m.mensajesRecibidos)} />
            <Dato
              titulo="Respuestas del agente"
              valor={String(m.respuestasDelAgente)}
              pie={m.respuestasDeUnaPersona > 0 ? `${m.respuestasDeUnaPersona} tuyas` : undefined}
            />
            <Dato
              titulo="Coste del mes"
              valor={`${m.costeUsd.toFixed(4)} $`}
              // Es el número que convierte «cuesta poco» en un argumento de
              // venta: se puede comparar con lo que cuesta una hora de alguien.
              pie={`${m.costePorConversacion.toFixed(4)} $ por conversación`}
            />
          </section>
        </>
      )}

      <section className="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Qué ha pasado
        </h2>

        {registro.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Todavía no hay nada registrado.</p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {registro.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
                    e.tono === "problema"
                      ? "bg-destructive"
                      : e.tono === "atencion"
                        ? "bg-warning"
                        : "bg-border"
                  }`}
                />

                <span className="flex-1">
                  {e.conversacionId ? (
                    <Link
                      href={`/app/inbox/${e.conversacionId}`}
                      className="transition hover:text-primary hover:underline"
                    >
                      {e.texto}
                    </Link>
                  ) : (
                    e.texto
                  )}
                </span>

                <time
                  dateTime={e.cuando}
                  className="dato flex-none text-xs text-muted-foreground"
                >
                  {new Date(e.cuando).toLocaleString("es-ES", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Dato({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="dato mt-1 text-xl font-semibold">{valor}</p>
      {pie && <p className="dato mt-0.5 text-xs text-muted-foreground">{pie}</p>}
    </div>
  );
}
