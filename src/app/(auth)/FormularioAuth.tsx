"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { EstadoAuth } from "./acciones";

function Boton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Un momento…" : children}
    </button>
  );
}

export function FormularioAuth({
  accion,
  titulo,
  descripcion,
  textoBoton,
  pie,
}: {
  accion: (estado: EstadoAuth, formData: FormData) => Promise<EstadoAuth>;
  titulo: string;
  descripcion: string;
  textoBoton: string;
  pie: { texto: string; enlace: string; href: string };
}) {
  const [estado, ejecutar] = useActionState(accion, undefined);

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-[var(--radius-card)] border border-border bg-card/70 p-7 backdrop-blur">
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{descripcion}</p>

        <form action={ejecutar} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium">
              Correo
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
              placeholder="tu@correo.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              className="w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          {estado?.error && (
            // role="alert" para que un lector de pantalla lo anuncie al aparecer
            <p
              role="alert"
              className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {estado.error}
            </p>
          )}

          <Boton>{textoBoton}</Boton>
        </form>
      </div>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {pie.texto}{" "}
        <Link href={pie.href} className="font-medium text-primary hover:underline">
          {pie.enlace}
        </Link>
      </p>
    </div>
  );
}
