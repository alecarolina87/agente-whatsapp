"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { alternarIA, enviarComoHumano, marcarLeida } from "@/app/app/inbox/acciones";
import { createClient } from "@/lib/supabase/client";
import type { HiloConversacion } from "@/lib/data/inbox-tipos";

import { AvisoHandoff, EstadoVentana } from "./EstadoVentana";

/**
 * El hilo de una conversación, con el interruptor y el cuadro de escribir.
 *
 * Es cliente porque necesita tres cosas que el servidor no da: escuchar los
 * mensajes nuevos en tiempo real, mantener el foco mientras se escribe y bajar
 * el scroll al final.
 *
 * Los datos iniciales llegan ya renderizados desde el servidor, así que la
 * conversación se ve completa antes de que el navegador ejecute nada.
 */
export function PanelConversacion({ hilo }: { hilo: HiloConversacion }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [borrador, setBorrador] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finDelHilo = useRef<HTMLDivElement>(null);

  // Al abrir y con cada mensaje nuevo, al final del hilo.
  useEffect(() => {
    finDelHilo.current?.scrollIntoView({ block: "end" });
  }, [hilo.mensajes.length]);

  // Abrirla es haberla leído. Va aquí y no en el render del servidor porque es
  // una escritura, y el render puede repetirse.
  useEffect(() => {
    void marcarLeida(hilo.id);
  }, [hilo.id]);

  /*
   * Tiempo real. Sin esto habría que recargar para ver lo que contesta un
   * cliente, y un inbox que se queda quieto no sirve para atender a nadie.
   *
   * Cuando llega algo se le pide al servidor que vuelva a renderizar en vez de
   * añadirlo aquí a mano: así el mensaje que se ve es el que hay en la base de
   * datos, y no una copia que podría desincronizarse.
   */
  useEffect(() => {
    const supabase = createClient();

    const canal = supabase
      .channel(`hilo:${hilo.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${hilo.id}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [hilo.id, router]);

  function enviar() {
    const texto = borrador.trim();
    if (!texto || pendiente) return;

    setError(null);
    iniciar(async () => {
      const r = await enviarComoHumano(hilo.id, texto);
      if (r.ok) setBorrador("");
      else setError(r.error ?? "No se pudo enviar");
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <p className="text-sm font-medium">
            {hilo.contacto.nombre ?? "Sin nombre"}
          </p>
          <p className="dato text-xs text-muted-foreground">{hilo.contacto.telefono}</p>
        </div>

        <div className="flex items-center gap-3">
          {hilo.estado === "handoff_pending" && <AvisoHandoff />}
          <EstadoVentana caducaEn={hilo.ventanaCaducaEn} />

          <button
            type="button"
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                await alternarIA(hilo.id, !hilo.iaActiva);
              })
            }
            className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
              hilo.iaActiva
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
            title={
              hilo.iaActiva
                ? "La IA está contestando. Púlsalo para atender tú."
                : "Atiendes tú. Púlsalo para devolvérselo a la IA."
            }
          >
            {hilo.iaActiva ? "IA activa" : "Atiendes tú"}
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {hilo.mensajes.length === 0 && (
          <p className="text-sm text-muted-foreground">Todavía no hay mensajes.</p>
        )}

        {hilo.mensajes.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.direccion === "in" ? "justify-start" : "justify-end"}`}
          >
            <div
              className={`max-w-[75%] rounded-[var(--radius-card)] px-3.5 py-2.5 text-sm ${
                m.direccion === "in"
                  ? "bg-card text-foreground"
                  : m.quien === "ai"
                    ? "bg-primary/15 text-foreground"
                    : "bg-muted text-foreground"
              }`}
            >
              {/* Quién escribió importa: no es lo mismo que conteste el agente
                  que una persona, y desde fuera se ve igual. */}
              {m.direccion === "out" && (
                <p className="dato mb-1 text-[11px] text-muted-foreground uppercase">
                  {m.quien === "ai" ? "IA" : "Tú"}
                </p>
              )}
              <p className="whitespace-pre-wrap">{m.texto ?? `[${m.tipo}]`}</p>
              <p className="dato mt-1 text-[11px] text-muted-foreground">
                {new Date(m.creadoEn).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}

        <div ref={finDelHilo} />
      </div>

      <div className="border-t border-border px-5 py-3.5">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

        {hilo.iaActiva && (
          <p className="mb-2 text-xs text-muted-foreground">
            Si escribes, la IA se pausa automáticamente en esta conversación.
          </p>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía, Mayús+Enter hace salto de línea: como WhatsApp.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            rows={2}
            placeholder="Escribe un mensaje…"
            className="flex-1 resize-none rounded-[var(--radius-control)] border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={enviar}
            disabled={pendiente || !borrador.trim()}
            className="rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition disabled:opacity-40"
          >
            {pendiente ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
