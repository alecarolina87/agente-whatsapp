"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { enviarPlantillaAlContacto } from "@/app/app/inbox/acciones";
import type { Plantilla } from "@/lib/plantillas/estados";

/**
 * Mandar una plantilla cuando la ventana de 24 h está cerrada.
 *
 * ## El callejón sin salida que resuelve
 *
 * Antes de esto, con la ventana cerrada quien atendía escribía un mensaje, le
 * salía «hace falta una plantilla aprobada»… y ahí se acababa. El aviso era
 * correcto y no servía de nada, porque no había forma de mandar ninguna. La
 * conversación se quedaba muerta.
 *
 * ## Por qué se pinta la vista previa
 *
 * Porque una plantilla con huecos no se entiende leyendo `{{1}}`. Quien la
 * manda tiene que ver **el mensaje que va a recibir la clienta**, con los datos
 * ya puestos: es la única forma de darse cuenta de que falta un espacio o de
 * que la fecha está en otro formato antes de enviarlo.
 */
export function EnviarPlantilla({
  conversacionId,
  negocioId,
  plantillas,
  nombreDelContacto,
}: {
  conversacionId: string;
  negocioId: string | null;
  plantillas: Plantilla[];
  nombreDelContacto: string | null;
}) {
  const [elegidaId, setElegidaId] = useState<string>("");
  const [valores, setValores] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const elegida = plantillas.find((p) => p.id === elegidaId) ?? null;

  function elegir(id: string) {
    setElegidaId(id);
    setError(null);
    setEnviada(false);

    const plantilla = plantillas.find((p) => p.id === id);
    if (!plantilla) return setValores([]);

    /*
     * El primer hueco se rellena con el nombre del contacto. Es el caso de
     * lejos más común —«Hola {{1}}, te recordamos…»— y evita tener que
     * copiarlo a mano desde la cabecera de la conversación.
     */
    setValores(
      Array.from({ length: plantilla.variable_count }, (_, i) =>
        i === 0 ? (nombreDelContacto ?? "") : "",
      ),
    );
  }

  const vistaPrevia = elegida
    ? valores.reduce(
        (texto, valor, i) =>
          texto.replaceAll(`{{${i + 1}}}`, valor || `{{${i + 1}}}`),
        elegida.body,
      )
    : "";

  if (plantillas.length === 0) {
    return (
      <div className="rounded-[var(--radius-control)] border border-warning/40 bg-warning/5 px-3 py-3 text-xs">
        <p className="text-warning">
          Han pasado más de 24 h desde el último mensaje. WhatsApp no deja
          escribir libremente, y este negocio no tiene ninguna plantilla
          aprobada.
        </p>
        {negocioId && (
          <Link
            href={`/app/negocios/${negocioId}/plantillas`}
            className="mt-1.5 inline-block text-primary hover:underline"
          >
            Crear una plantilla
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-warning">
        Han pasado más de 24 h desde el último mensaje. Solo se puede enviar una
        plantilla aprobada.
      </p>

      <select
        aria-label="Plantilla a enviar"
        value={elegidaId}
        onChange={(e) => elegir(e.target.value)}
        className="w-full rounded-[var(--radius-control)] border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
      >
        <option value="">Elige una plantilla…</option>
        {plantillas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {elegida && (
        <>
          {valores.map((valor, i) => (
            <input
              key={i}
              value={valor}
              onChange={(e) => {
                const siguiente = [...valores];
                siguiente[i] = e.target.value;
                setValores(siguiente);
                setError(null);
              }}
              placeholder={`Dato ${i + 1}`}
              className="w-full rounded-[var(--radius-control)] border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
          ))}

          {/* Lo que va a leer la clienta, no lo que hay guardado. */}
          <div className="rounded-[var(--radius-control)] border border-border bg-muted/50 px-3 py-2">
            <p className="dato mb-1 text-[11px] text-muted-foreground">
              Le llegará esto:
            </p>
            <p className="text-sm whitespace-pre-wrap">{vistaPrevia}</p>
          </div>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {enviada && (
        <p role="status" className="text-xs text-success">
          Enviada. La ventana no se reabre hasta que la clienta conteste.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={pendiente || !elegida}
          onClick={() =>
            iniciar(async () => {
              setError(null);
              const r = await enviarPlantillaAlContacto(
                conversacionId,
                elegidaId,
                valores,
              );
              if (r.ok) {
                setEnviada(true);
                setElegidaId("");
                setValores([]);
              } else {
                setError(r.error ?? "No se pudo enviar");
              }
            })
          }
          className="rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition disabled:opacity-40"
        >
          {pendiente ? "Enviando…" : "Enviar plantilla"}
        </button>
      </div>
    </div>
  );
}
