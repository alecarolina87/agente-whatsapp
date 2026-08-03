"use client";

import { useState, useTransition } from "react";

import { validarClavesYCloud } from "@/app/app/negocios/acciones";

/**
 * Botón de «comprobar» junto a los campos de credenciales.
 *
 * Preguntarle a YCloud si la clave sirve **antes** de guardarla, en vez de
 * enterarse días después de que una clienta escribió y nadie le contestó. Ese
 * es el peor momento posible para descubrirlo: el canal figura como conectado,
 * así que nada apunta a la causa.
 *
 * Comprueba además que el teléfono dado de alta esté en esa cuenta de YCloud.
 * Ese fallo ya ocurrió en este proyecto —un canal con un número que no era el
 * conectado— y se descubrió por casualidad.
 *
 * No bloquea el guardado a propósito: puede haber una caída de YCloud, y no
 * poder dar de alta a un cliente porque su proveedor está caído sería peor que
 * el problema que resuelve.
 */
export function ComprobarClaves({
  obtenerApiKey,
  obtenerTelefono,
}: {
  obtenerApiKey: () => string;
  obtenerTelefono?: () => string;
}) {
  const [estado, setEstado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            const apiKey = obtenerApiKey().trim();
            if (!apiKey) {
              setEstado({ ok: false, mensaje: "Escribe primero la API Key." });
              return;
            }

            setEstado(null);
            const r = await validarClavesYCloud({
              apiKey,
              telefono: obtenerTelefono?.().trim() || undefined,
            });
            setEstado({ ok: r.ok, mensaje: r.mensaje });
          })
        }
        className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs transition hover:bg-muted disabled:opacity-50"
      >
        {pendiente ? "Preguntando a YCloud…" : "Comprobar la clave"}
      </button>

      {estado && (
        <p
          role="status"
          className={`rounded-[var(--radius-control)] border px-3 py-2 text-xs ${
            estado.ok
              ? "border-success/40 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning"
          }`}
        >
          {estado.mensaje}
        </p>
      )}
    </div>
  );
}
