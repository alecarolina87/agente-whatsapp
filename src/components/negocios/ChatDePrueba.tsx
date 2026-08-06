"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  probarAgente,
  type TurnoPrueba,
} from "@/app/app/negocios/[negocioId]/probar/acciones";

/**
 * Conversación de prueba con el agente.
 *
 * El historial vive aquí, en el navegador, y viaja entero en cada llamada. Es
 * lo que permite probar sin ensuciar la bandeja con conversaciones falsas — y
 * también significa que **al recargar la página se pierde**, que es justo lo
 * que se quiere: cada prueba empieza limpia, sin arrastrar lo que dijiste hace
 * media hora con otro prompt.
 *
 * Debajo de cada respuesta se enseña lo que ha costado. No es un adorno
 * técnico: es la única forma de que ajustar la memoria del agente o la
 * longitud del prompt deje de ser una decisión a ciegas.
 */
export function ChatDePrueba({ negocioId }: { negocioId: string }) {
  const [turnos, setTurnos] = useState<TurnoPrueba[]>([]);
  const [costes, setCostes] = useState<
    Record<
      number,
      { usd: number; handoff: string | null; modelo: string; conRespaldo: boolean }
    >
  >({});
  const [borrador, setBorrador] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const final = useRef<HTMLDivElement>(null);

  useEffect(() => {
    final.current?.scrollIntoView({ block: "end" });
  }, [turnos.length, pendiente]);

  const total = Object.values(costes).reduce((s, c) => s + c.usd, 0);

  function enviar() {
    const texto = borrador.trim();
    if (!texto || pendiente) return;

    const conMio: TurnoPrueba[] = [...turnos, { rol: "contacto", texto }];
    setTurnos(conMio);
    setBorrador("");
    setError(null);

    iniciar(async () => {
      const r = await probarAgente(negocioId, conMio);

      if (!r.ok) {
        setError(r.error);
        // Se quita el mensaje que no llegó a contestarse: dejarlo colgado haría
        // creer que el agente lo ignoró, y lo que pasó es que ni lo recibió.
        setTurnos(turnos);
        return;
      }

      setTurnos((t) => {
        const siguiente: TurnoPrueba[] = [...t, { rol: "agente", texto: r.texto }];
        setCostes((c) => ({
          ...c,
          [siguiente.length - 1]: {
            usd: r.costeUsd,
            handoff: r.handoff,
            modelo: r.modelo,
            conRespaldo: r.conRespaldo,
          },
        }));
        return siguiente;
      });
    });
  }

  return (
    <section className="flex h-[32rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Chat de prueba
        </p>
        <div className="flex items-center gap-3">
          {total > 0 && (
            <span className="dato text-xs text-muted-foreground">
              {total.toFixed(4)} $ en esta prueba
            </span>
          )}
          {turnos.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTurnos([]);
                setCostes({});
                setError(null);
              }}
              className="dato text-xs text-muted-foreground transition hover:text-foreground"
            >
              Empezar de nuevo
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turnos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Escribe como escribiría una clienta y mira qué contesta. No se manda
            ningún WhatsApp y no queda nada en la bandeja.
          </p>
        )}

        {turnos.map((t, i) => (
          <div
            key={i}
            className={`flex ${t.rol === "contacto" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-[var(--radius-card)] px-3.5 py-2.5 text-sm ${
                t.rol === "contacto" ? "bg-muted" : "bg-primary/15"
              }`}
            >
              <p className="whitespace-pre-wrap">{t.texto}</p>

              {costes[i] && (
                <p className="dato mt-1.5 text-[11px] text-muted-foreground">
                  {costes[i].usd.toFixed(6)} $
                  {/* Qué modelo contestó de verdad, no cuál está elegido: son
                      cosas distintas en cuanto entra el respaldo, y comparar
                      calidad sin saber cuál escribió no sirve de nada. */}
                  {" · "}
                  {costes[i].modelo}
                  {costes[i].conRespaldo && (
                    <span className="text-warning"> · falló el principal</span>
                  )}
                  {costes[i].handoff && (
                    // En una conversación real esto habría apagado la IA. Verlo
                    // aquí evita descubrirlo con una clienta delante.
                    <span className="text-warning"> · habría pasado a una persona</span>
                  )}
                </p>
              )}
            </div>
          </div>
        ))}

        {pendiente && (
          <p className="text-sm text-muted-foreground">Pensando…</p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div ref={final} />
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="flex gap-2">
          <textarea
            rows={2}
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía, Mayús+Enter salta de línea: es lo que la mano ya
              // espera después de años de WhatsApp.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder="Hola, ¿cuánto cuesta una limpieza dental?"
            className="flex-1 resize-none rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={enviar}
            disabled={pendiente || !borrador.trim()}
            className="rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </div>
    </section>
  );
}
