"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import {
  darAcceso,
  quitarAcceso,
  type ResultadoInvitacion,
} from "@/app/app/negocios/[negocioId]/equipo/acciones";

/**
 * Quién entra al panel de este negocio.
 *
 * La contraseña se enseña **una sola vez** y no se guarda en ninguna parte
 * legible. Si se pierde, se genera otra: es más seguro que poder consultarla,
 * y además obliga a copiarla en el momento, que es cuando se está hablando con
 * el cliente.
 */

const CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

const ROLES = [
  { id: "admin", nombre: "Admin", puede: "Todo, incluido dar acceso a otros" },
  { id: "manager", nombre: "Manager", puede: "Configura el agente y atiende" },
  { id: "agent", nombre: "Agente", puede: "Atiende conversaciones" },
  { id: "viewer", nombre: "Solo lectura", puede: "Mira, no toca" },
];

function Boton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Creando…" : "Dar acceso"}
    </button>
  );
}

export function FormularioEquipo({
  negocioId,
  miembros,
  yoSoy,
}: {
  negocioId: string;
  miembros: { userId: string; correo: string; rol: string; desde: string }[];
  yoSoy: string | null;
}) {
  const [estado, ejecutar] = useActionState<ResultadoInvitacion | null, FormData>(
    darAcceso.bind(null, negocioId),
    null,
  );
  const [copiado, setCopiado] = useState(false);
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const credenciales =
    estado?.ok && estado.contrasena
      ? `Entra en https://agente-whatsapp-servicios-digitales.vercel.app/entrar\n\nCorreo: ${estado.correo}\nContraseña: ${estado.contrasena}`
      : null;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Dar acceso
          </h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Se crea su cuenta al momento con una contraseña.{" "}
            <span className="text-foreground">No se manda ningún correo</span>: se
            la pasas tú por donde ya estés hablando con esa persona.
          </p>
        </div>

        <form action={ejecutar} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <label htmlFor="correo" className="block text-sm font-medium">
              Su correo
            </label>
            <input
              id="correo"
              name="correo"
              type="email"
              required
              className={CAMPO}
              placeholder="emilce@clinicadentalone.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rol" className="block text-sm font-medium">
              Qué puede hacer
            </label>
            <select id="rol" name="rol" defaultValue="admin" className={CAMPO}>
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre} — {r.puede}
                </option>
              ))}
            </select>
          </div>

          <Boton />
        </form>

        {estado && !estado.ok && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {estado.error}
          </p>
        )}

        {/*
          La contraseña, una sola vez. Al recargar desaparece y no hay forma de
          recuperarla: si se pierde, se crea otra. Es más seguro que poder
          consultarla en cualquier momento.
        */}
        {estado?.ok && estado.contrasena && (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-success/40 bg-success/10 p-4">
            <p className="text-sm text-success">
              Cuenta creada. <strong>Copia esto ahora</strong> — la contraseña no
              se vuelve a mostrar.
            </p>

            <pre className="dato overflow-x-auto rounded-[var(--radius-control)] border border-border bg-background p-3 text-xs whitespace-pre-wrap">
              {credenciales}
            </pre>

            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(credenciales!);
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              }}
              className="rounded-[var(--radius-control)] bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110"
            >
              {copiado ? "Copiado" : "Copiar para enviar"}
            </button>
          </div>
        )}

        {estado?.ok && !estado.contrasena && (
          <p
            role="status"
            className="rounded-[var(--radius-control)] border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
          >
            {estado.correo} ya tenía cuenta, así que entra con su contraseña de
            siempre. Ya tiene acceso a este negocio.
          </p>
        )}
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Quién entra ahora
        </h2>

        <ul className="mt-4 space-y-2.5">
          {miembros.map((m) => (
            <li
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2.5 last:border-0 last:pb-0"
            >
              <div>
                <p className="dato text-sm">
                  {m.correo}
                  {m.userId === yoSoy && (
                    <span className="ml-2 text-xs text-muted-foreground">(tú)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ROLES.find((r) => r.id === m.rol)?.nombre ?? m.rol} · desde el{" "}
                  {new Date(m.desde).toLocaleDateString("es-ES")}
                </p>
              </div>

              {/* No se puede quitar uno a sí mismo: es la forma más rápida de
                  perder el acceso a tu propio negocio sin querer. */}
              {m.userId !== yoSoy && (
                <button
                  type="button"
                  disabled={pendiente}
                  onClick={() =>
                    iniciar(async () => {
                      setErrorQuitar(null);
                      const r = await quitarAcceso(negocioId, m.userId);
                      if (!r.ok) setErrorQuitar(r.error ?? "No se pudo quitar");
                    })
                  }
                  className="dato text-xs text-muted-foreground transition hover:text-destructive disabled:opacity-50"
                >
                  Quitar acceso
                </button>
              )}
            </li>
          ))}
        </ul>

        {errorQuitar && (
          <p
            role="alert"
            className="mt-3 rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errorQuitar}
          </p>
        )}
      </section>
    </div>
  );
}
