import Link from "next/link";

import type { PuestaEnMarcha as Datos } from "@/lib/data/puesta-en-marcha";

/**
 * Qué le falta a este negocio para atender.
 *
 * Cuando está todo hecho se encoge a una línea: una lista de siete tics verdes
 * ocupa media pantalla para no decir nada. Lo que interesa ver es lo que falta.
 */
export function PuestaEnMarcha({ datos }: { datos: Datos }) {
  const pendientes = datos.pasos.filter((p) => !p.hecho);

  if (datos.operativo && pendientes.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
        Todo listo. Este negocio está atendiendo.
      </p>
    );
  }

  return (
    <section
      className={`rounded-[var(--radius-card)] border p-6 ${
        datos.operativo ? "border-border bg-card/60" : "border-warning/40 bg-warning/5"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Puesta en marcha
        </h2>
        <span className="dato text-xs text-muted-foreground">
          {datos.listos} de {datos.imprescindibles}
        </span>
      </div>

      <p className={`mt-2 text-sm ${datos.operativo ? "text-success" : "text-warning"}`}>
        {datos.operativo
          ? "Está atendiendo. Lo que queda es recomendable, no imprescindible."
          : "Todavía no atiende a nadie."}
      </p>

      <ul className="mt-4 space-y-3">
        {datos.pasos.map((p) => (
          <li key={p.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] ${
                p.hecho
                  ? "bg-success/20 text-success"
                  : p.opcional
                    ? "bg-muted text-muted-foreground"
                    : "bg-warning/20 text-warning"
              }`}
            >
              {p.hecho ? "✓" : "!"}
            </span>

            <div className="flex-1">
              <p className={`text-sm ${p.hecho ? "text-muted-foreground" : ""}`}>
                {p.titulo}
                {p.opcional && !p.hecho && (
                  <span className="dato ml-2 text-xs text-muted-foreground">recomendable</span>
                )}
              </p>

              {/* La consecuencia solo cuando falta: es lo que convence de
                  hacerlo. Con el paso hecho, sobra y hace ruido. */}
              {!p.hecho && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.consecuencia}{" "}
                  {p.enlace && (
                    <Link href={p.enlace} className="text-primary hover:underline">
                      Resolverlo
                    </Link>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
