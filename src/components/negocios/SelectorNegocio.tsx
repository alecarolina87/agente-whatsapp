"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { elegirNegocio } from "@/app/app/negocios/acciones";

/**
 * Cambiar de cliente desde la cabecera.
 *
 * Es un `<select>` nativo a propósito: en el móvil abre el selector del
 * sistema, funciona con teclado sin escribir una línea, y no hay ningún menú
 * hecho a mano que mantener. Con veinte clientes seguiría yendo bien.
 *
 * La elección se guarda en el servidor, no aquí. Si viviera en el navegador,
 * la bandeja —que se pinta en el servidor— no sabría cuál mirar.
 */
export function SelectorNegocio({
  negocios,
  actual,
}: {
  negocios: { id: string; nombre: string }[];
  actual: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  // Con uno solo no hay nada que elegir; el nombre se enseña sin adornos.
  if (negocios.length <= 1) {
    return (
      <span className="text-sm text-muted-foreground">
        {negocios[0]?.nombre ?? "Sin negocios"}
      </span>
    );
  }

  return (
    <select
      aria-label="Negocio"
      value={actual}
      disabled={pendiente}
      onChange={(e) => {
        const id = e.target.value;
        iniciar(async () => {
          await elegirNegocio(id);
          // La bandeja depende del negocio elegido, así que hay que volver a
          // pedirla: sin esto se quedaría enseñando las conversaciones del
          // cliente anterior.
          router.refresh();
        });
      }}
      className="rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-1.5 text-sm outline-none disabled:opacity-60"
    >
      {negocios.map((n) => (
        <option key={n.id} value={n.id}>
          {n.nombre}
        </option>
      ))}
    </select>
  );
}
