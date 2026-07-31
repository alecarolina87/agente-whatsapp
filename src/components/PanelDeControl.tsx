"use client";

import { useTransition } from "react";

import { alternarIaDelWorkspace } from "@/app/app/acciones";

/**
 * Estado del agente y freno de mano.
 *
 * Va en la portada del área privada y no escondido en ajustes, a propósito: un
 * botón de emergencia que hay que buscar no es un botón de emergencia.
 */
export function PanelDeControl({
  workspaceId,
  nombre,
  iaActiva,
  gastado,
  tope,
}: {
  workspaceId: string;
  nombre: string;
  iaActiva: boolean;
  gastado: number;
  tope: number | null;
}) {
  const [pendiente, iniciar] = useTransition();

  const porcentaje = tope && tope > 0 ? Math.min(100, (gastado / tope) * 100) : null;

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            El agente
          </h2>
          <p className="mt-1.5 text-sm">
            {iaActiva ? (
              <span className="text-success">Respondiendo en {nombre}</span>
            ) : (
              <span className="text-destructive">Parado en {nombre}</span>
            )}
          </p>
        </div>

        <button
          type="button"
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              await alternarIaDelWorkspace(workspaceId, !iaActiva);
            })
          }
          className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            iaActiva
              ? "border border-destructive/50 text-destructive hover:bg-destructive/10"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {pendiente ? "…" : iaActiva ? "Parar el agente" : "Reanudar"}
        </button>
      </div>

      {!iaActiva && (
        <p className="mt-4 rounded-[var(--radius-control)] bg-muted px-3.5 py-2.5 text-xs text-muted-foreground">
          Los mensajes se siguen recibiendo y guardando. Lo único que no ocurre
          es que el agente conteste, así que puedes atender tú desde el inbox.
        </p>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Gasto de este mes</span>
          <span className="dato text-sm">
            {gastado.toFixed(4)} $
            {tope !== null && (
              <span className="text-muted-foreground"> / {tope.toFixed(2)} $</span>
            )}
          </span>
        </div>

        {porcentaje !== null ? (
          <>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-[width] ${
                  porcentaje >= 100
                    ? "bg-destructive"
                    : porcentaje >= 80
                      ? "bg-warning"
                      : "bg-primary"
                }`}
                style={{ width: `${porcentaje}%` }}
              />
            </div>
            {porcentaje >= 100 && (
              <p className="mt-2 text-xs text-destructive">
                Tope alcanzado: el agente no responderá hasta el mes que viene o
                hasta que subas el límite.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Sin tope configurado. El agente responderá cueste lo que cueste.
          </p>
        )}
      </div>
    </section>
  );
}
