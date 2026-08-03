"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  guardarClaves,
  type EstadoAjustes,
} from "@/app/app/negocios/[negocioId]/ajustes/acciones";

/**
 * Conectar el WhatsApp de un negocio, o cambiarle las claves.
 *
 * Va aparte de los demás ajustes por una razón práctica: los campos de clave
 * llegan **siempre vacíos**, porque un secreto guardado no se vuelve a mostrar.
 * Si compartieran formulario con el resto, cambiar el nombre del negocio
 * borraría sus claves sin que nadie se diera cuenta.
 *
 * Cuando ya está conectado el formulario llega plegado: reemplazar unas claves
 * que funcionan es lo que menos falta hace y lo que más daño causa si se hace
 * por error.
 */

const CLASE_CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

function Boton({ conectado }: { conectado: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Guardando…" : conectado ? "Reemplazar las claves" : "Conectar WhatsApp"}
    </button>
  );
}

export function FormularioClaves({
  negocioId,
  conectado,
}: {
  negocioId: string;
  conectado: boolean;
}) {
  const [estado, ejecutar] = useActionState<EstadoAjustes, FormData>(
    guardarClaves.bind(null, negocioId),
    {},
  );
  const [abierto, setAbierto] = useState(!conectado);

  return (
    <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Sus claves de YCloud
        </h2>

        {conectado && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="dato text-xs text-primary transition hover:underline"
          >
            {abierto ? "Dejarlas como están" : "Cambiarlas"}
          </button>
        )}
      </div>

      {conectado && !abierto ? (
        <p className="text-sm text-muted-foreground">
          Conectado. Las claves están guardadas cifradas y no se pueden volver a
          ver — solo reemplazar.
        </p>
      ) : (
        <form action={ejecutar} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Están en la cuenta de YCloud del cliente. Van juntas: una sirve para
            enviar mensajes y la otra para comprobar que los que llegan son de
            verdad.
          </p>

          <div className="space-y-1.5">
            <label htmlFor="apiKey" className="block text-sm font-medium">
              API Key
            </label>
            <input
              id="apiKey"
              name="apiKey"
              type="password"
              autoComplete="off"
              required
              className={CLASE_CAMPO}
              placeholder="••••••••••••"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="webhookSecret" className="block text-sm font-medium">
              Webhook Secret
            </label>
            <input
              id="webhookSecret"
              name="webhookSecret"
              type="password"
              autoComplete="off"
              required
              className={CLASE_CAMPO}
              placeholder="••••••••••••"
            />
          </div>

          {estado.error && (
            <p
              role="alert"
              className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {estado.error}
            </p>
          )}

          {estado.guardado && (
            <p
              role="status"
              className="rounded-[var(--radius-control)] border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
            >
              Claves guardadas. Ya solo falta pegar su URL de webhook en YCloud.
            </p>
          )}

          <div className="flex justify-end">
            <Boton conectado={conectado} />
          </div>
        </form>
      )}
    </section>
  );
}
