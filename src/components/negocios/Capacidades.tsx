"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  guardarCapacidad,
  type EstadoCapacidad,
} from "@/app/app/negocios/[negocioId]/capacidades/acciones";
import {
  HERRAMIENTAS,
  type Herramienta,
} from "@/lib/agent/herramientas/catalogo";

/**
 * Qué sabe hacer el agente de este negocio, además de escribir.
 *
 * ## Lo que la pantalla tiene que dejar claro
 *
 * Que **activar no basta**. Una capacidad sin su configuración no se enciende,
 * y el motivo importa: si el agente pudiera llamarla, recibiría un hueco y le
 * daría a la clienta un enlace inventado. Por eso el interruptor y el campo van
 * juntos, no en sitios distintos.
 */

const CLASE_CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

function Boton({ activa }: { activa: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Guardando…" : activa ? "Guardar" : "Activar"}
    </button>
  );
}

function Ficha({
  herramienta,
  negocioId,
  inicial,
}: {
  herramienta: Herramienta;
  negocioId: string;
  inicial: { activa: boolean; config: Record<string, string> };
}) {
  const [estado, ejecutar] = useActionState<EstadoCapacidad, FormData>(
    guardarCapacidad.bind(null, negocioId, herramienta.clave),
    {},
  );
  const [activa, setActiva] = useState(inicial.activa);

  return (
    <form
      action={ejecutar}
      className={`space-y-4 rounded-[var(--radius-card)] border p-6 ${
        inicial.activa
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-card/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{herramienta.nombre}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {herramienta.descripcion}
          </p>
        </div>

        {/* Solo se marca lo que cambia algo fuera. Dar un enlace y crear una
            cita en la agenda de alguien no son lo mismo. */}
        {herramienta.efecto === "escritura" && (
          <span className="dato rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning">
            Hace cambios
          </span>
        )}
      </div>

      {herramienta.config.map((campo) => (
        <div key={campo.clave} className="space-y-1.5">
          <label
            htmlFor={`${herramienta.clave}-${campo.clave}`}
            className="block text-sm font-medium"
          >
            {campo.etiqueta}
          </label>
          <input
            id={`${herramienta.clave}-${campo.clave}`}
            name={campo.clave}
            type={campo.tipo === "url" ? "url" : "text"}
            defaultValue={inicial.config[campo.clave] ?? ""}
            placeholder={campo.marcador}
            className={`${CLASE_CAMPO} dato`}
          />
          <p className="text-xs text-muted-foreground">{campo.ayuda}</p>
        </div>
      ))}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="activa"
          value="si"
          checked={activa}
          onChange={(e) => setActiva(e.target.checked)}
        />
        <span>El agente puede usarla</span>
      </label>

      {estado.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {estado.error}
        </p>
      )}

      {estado.ok && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          {estado.aviso}
        </p>
      )}

      <div className="flex justify-end">
        <Boton activa={inicial.activa} />
      </div>
    </form>
  );
}

export function Capacidades({
  negocioId,
  configuradas,
}: {
  negocioId: string;
  configuradas: Record<
    string,
    { activa: boolean; config: Record<string, string> }
  >;
}) {
  return (
    <div className="space-y-4">
      {HERRAMIENTAS.map((h) => (
        <Ficha
          key={h.clave}
          herramienta={h}
          negocioId={negocioId}
          inicial={configuradas[h.clave] ?? { activa: false, config: {} }}
        />
      ))}
    </div>
  );
}
