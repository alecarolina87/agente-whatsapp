"use client";

import { useState } from "react";

/**
 * La dirección que hay que pegar en YCloud.
 *
 * Se construye en el navegador con `window.location.origin` en vez de leerla
 * de una variable de entorno: así en local dice `localhost` y desplegada dice
 * el dominio de verdad, sin que nadie tenga que acordarse de configurarlo. Una
 * URL de webhook equivocada es de los fallos más difíciles de encontrar,
 * porque no da error — simplemente no llega nada.
 */
export function UrlWebhook({
  negocioId,
  conectado,
}: {
  negocioId: string;
  conectado: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  // En el primer render del servidor no hay `window`; queda vacío un instante.
  const url =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/webhooks/ycloud/${negocioId}`;

  async function copiar() {
    await navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <section
      className={`rounded-[var(--radius-card)] border p-6 ${
        conectado ? "border-border bg-card/60" : "border-warning/40 bg-warning/5"
      }`}
    >
      <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Conectar con YCloud
      </h2>

      <p className="mt-2 text-sm">
        {conectado ? (
          <>
            Sus claves están guardadas. Pega esta dirección en el webhook de su
            cuenta de YCloud y empezará a recibir mensajes.
          </>
        ) : (
          <>
            <span className="text-warning">Le faltan las claves de YCloud.</span>{" "}
            Sin ellas el webhook rechaza todo lo que llegue, porque no puede
            comprobar que venga de verdad de WhatsApp.
          </>
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="dato flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-xs whitespace-nowrap">
          {url || "…"}
        </code>
        <button
          type="button"
          onClick={copiar}
          disabled={!url}
          className="rounded-[var(--radius-control)] border border-border px-3 py-2 text-xs transition hover:bg-muted disabled:opacity-50"
        >
          {copiado ? "Copiada" : "Copiar"}
        </button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Cada negocio tiene la suya. Que alguien la adivine no sirve de nada: sin
        el secreto no se puede firmar un mensaje, y sin firma válida se rechaza.
      </p>
    </section>
  );
}
