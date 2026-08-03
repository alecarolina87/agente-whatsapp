"use client";

import { useState, useTransition } from "react";

import { guardarPrompt } from "@/app/app/negocios/[negocioId]/probar/acciones";

/**
 * Las instrucciones del agente, junto al chat de prueba.
 *
 * El valor de esta pantalla está en la distancia: escribir una frase, guardar,
 * preguntar, y ver el efecto sin cambiar de sitio. Con el editor en otra
 * página, cada iteración cuesta dos clics y la atención se pierde por el
 * camino — así que casi nadie itera, y el prompt se queda en el primer intento.
 */
export function EditorPrompt({
  negocioId,
  inicial,
}: {
  negocioId: string;
  inicial: string;
}) {
  const [texto, setTexto] = useState(inicial);
  const [guardado, setGuardado] = useState<string | null>(inicial);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const sinGuardar = texto !== guardado;

  return (
    <section className="flex h-[32rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Cómo habla
        </p>

        <div className="flex items-center gap-3">
          {/* Avisa de que lo escrito todavía no es lo que contesta el agente:
              probar con cambios sin guardar daría un resultado engañoso. */}
          {sinGuardar && (
            <span className="dato text-xs text-warning">Sin guardar</span>
          )}
          <button
            type="button"
            disabled={pendiente || !sinGuardar}
            onClick={() =>
              iniciar(async () => {
                setError(null);
                const r = await guardarPrompt(negocioId, texto);
                if (r.ok) setGuardado(texto);
                else setError(r.error ?? "No se pudo guardar");
              })
            }
            className="rounded-[var(--radius-control)] bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {pendiente ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={8000}
        placeholder={
          "Eres quien atiende el WhatsApp de una clínica dental en Palma.\n" +
          "Hablas de usted, con calma y sin tecnicismos.\n" +
          "Puedes informar de tratamientos, precios orientativos y horarios.\n" +
          "No das diagnósticos ni valoras radiografías: eso lo ve un dentista."
        }
        className="flex-1 resize-none bg-background px-4 py-4 text-sm outline-none placeholder:text-muted-foreground/60"
      />

      <div className="border-t border-border px-4 py-2.5">
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="dato text-xs text-muted-foreground">
            {texto.length} / 8000 caracteres
          </p>
        )}
      </div>
    </section>
  );
}
