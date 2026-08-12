"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import {
  anadirContacto,
  borrarContacto,
  importarContactos,
  type EstadoContacto,
} from "@/app/app/contactos/acciones";
import type { Contacto } from "@/lib/data/contactos";

/**
 * Los contactos de un negocio: verlos, buscarlos, añadirlos e importarlos.
 *
 * ## Por qué el consentimiento se ve en la lista
 *
 * Porque es el dato que decide si se le puede escribir a alguien, y sin verlo
 * la decisión se toma a ciegas. Meta no avisa antes: avisa degradando la
 * calidad del número del cliente, y para entonces ya está hecho.
 */

const CLASE_CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

function BotonEnviar({ texto, cargando }: { texto: string; cargando: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? cargando : texto}
    </button>
  );
}

function Aviso({ estado }: { estado: EstadoContacto }) {
  if (estado.error) {
    return (
      <p
        role="alert"
        className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {estado.error}
      </p>
    );
  }

  if (estado.ok) {
    return (
      <p
        role="status"
        className="rounded-[var(--radius-control)] border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
      >
        {estado.resumen ?? "Hecho."}
      </p>
    );
  }

  return null;
}

function Fila({
  contacto,
  negocioId,
}: {
  contacto: Contacto;
  negocioId: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, iniciar] = useTransition();

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm">
          {contacto.name ?? (
            <span className="text-muted-foreground">Sin nombre</span>
          )}
        </p>
        <p className="dato truncate text-xs text-muted-foreground">
          {contacto.wa_phone}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {/*
          Ámbar, no rojo: no está roto, es una tarea pendiente. El rojo se
          reserva para lo que ya ha fallado.
        */}
        {!contacto.opt_in && (
          <span
            className="dato rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning"
            title="No consta que diera permiso para recibir mensajes"
          >
            Sin consentimiento
          </span>
        )}

        {contacto.last_interaction_at && (
          <span className="dato hidden text-xs text-muted-foreground sm:inline">
            {new Date(contacto.last_interaction_at).toLocaleDateString("es-ES")}
          </span>
        )}

        {confirmando ? (
          <>
            <button
              type="button"
              disabled={trabajando}
              onClick={() =>
                iniciar(
                  async () =>
                    void (await borrarContacto(negocioId, contacto.id)),
                )
              }
              className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive disabled:opacity-50"
            >
              {trabajando ? "Borrando…" : "Sí, borrar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="dato text-xs text-muted-foreground hover:text-foreground"
            >
              No
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="dato text-xs text-muted-foreground transition hover:text-destructive"
            title="Borra también sus conversaciones y mensajes"
          >
            Borrar
          </button>
        )}
      </div>
    </li>
  );
}

export function ListaContactos({
  negocioId,
  contactos,
  total,
  sinConsentimiento,
  busqueda,
}: {
  negocioId: string;
  contactos: Contacto[];
  total: number;
  sinConsentimiento: number;
  busqueda: string;
}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [texto, setTexto] = useState(busqueda);
  const [abierto, setAbierto] = useState<"ninguno" | "uno" | "lista">(
    "ninguno",
  );

  const [estadoUno, anadir] = useActionState<EstadoContacto, FormData>(
    anadirContacto.bind(null, negocioId),
    {},
  );
  const [estadoLista, importar] = useActionState<EstadoContacto, FormData>(
    importarContactos.bind(null, negocioId),
    {},
  );

  function buscar(valor: string) {
    const siguientes = new URLSearchParams(parametros.toString());
    if (valor.trim()) siguientes.set("q", valor.trim());
    else siguientes.delete("q");
    // Al buscar se vuelve a la primera página: quedarse en la 3 de un
    // resultado que tiene una sola página enseña una lista vacía.
    siguientes.delete("p");
    router.push(`/app/contactos?${siguientes}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm">
            {total} {total === 1 ? "contacto" : "contactos"}
          </p>
          {sinConsentimiento > 0 && (
            <p className="mt-0.5 text-xs text-warning">
              {sinConsentimiento} sin consentimiento registrado
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAbierto(abierto === "uno" ? "ninguno" : "uno")}
            className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs transition hover:bg-muted"
          >
            Añadir uno
          </button>
          <button
            type="button"
            onClick={() =>
              setAbierto(abierto === "lista" ? "ninguno" : "lista")
            }
            className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs transition hover:bg-muted"
          >
            Importar una lista
          </button>
        </div>
      </div>

      {abierto === "uno" && (
        <form
          action={anadir}
          className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card/60 p-5"
        >
          <input
            name="telefono"
            required
            placeholder="+34600000000"
            className={`${CLASE_CAMPO} dato`}
          />
          <input
            name="nombre"
            placeholder="Nombre (opcional)"
            className={CLASE_CAMPO}
          />
          <input
            name="email"
            type="email"
            placeholder="Correo (opcional)"
            className={CLASE_CAMPO}
          />
          <Aviso estado={estadoUno} />
          <div className="flex justify-end">
            <BotonEnviar texto="Añadir" cargando="Añadiendo…" />
          </div>
        </form>
      )}

      {abierto === "lista" && (
        <form
          action={importar}
          className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card/60 p-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="lista" className="block text-sm font-medium">
              Pega la lista
            </label>
            <textarea
              id="lista"
              name="lista"
              rows={7}
              required
              placeholder={
                "+34600000000, María\n600000001;Lucía Pérez\n600000002"
              }
              className={`${CLASE_CAMPO} dato resize-y`}
            />
            <p className="text-xs text-muted-foreground">
              Una por línea: el teléfono primero y el nombre después. Sirve la
              coma, el punto y coma o pegar dos columnas de Excel directamente.
              Si un número ya está, no se duplica.
            </p>
          </div>

          {/*
            El consentimiento no se supone. Quien escribe por WhatsApp da
            permiso al escribir; una lista importada no trae ese permiso de
            ninguna parte, y escribir a quien no lo dio puede costarle al
            cliente su cuenta de WhatsApp.
          */}
          <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-background p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="conConsentimiento"
                value="si"
                className="mt-0.5"
              />
              <span>
                Estas personas dieron permiso para recibir mensajes de este
                negocio.
              </span>
            </label>

            <input
              name="origen"
              placeholder="¿De dónde salió? Ej: formulario de la web, mayo 2026"
              className={CLASE_CAMPO}
            />

            <p className="text-xs text-muted-foreground">
              Si no lo marcas, entran igual pero señalados como{" "}
              <span className="text-warning">sin consentimiento</span>. Es lo
              honesto: WhatsApp no avisa antes de penalizar el número, y quien
              lo paga es el cliente.
            </p>
          </div>

          <Aviso estado={estadoLista} />

          <div className="flex justify-end">
            <BotonEnviar texto="Importar" cargando="Importando…" />
          </div>
        </form>
      )}

      <div className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") buscar(texto);
          }}
          placeholder="Buscar por nombre o teléfono…"
          aria-label="Buscar contactos"
          className={CLASE_CAMPO}
        />
        <button
          type="button"
          onClick={() => buscar(texto)}
          className="rounded-[var(--radius-control)] border border-border px-4 text-sm transition hover:bg-muted"
        >
          Buscar
        </button>
      </div>

      {contactos.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-border bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
          {busqueda
            ? `Nadie coincide con «${busqueda}».`
            : "Todavía no hay contactos. Aparecen solos cuando alguien escribe, o los puedes importar."}
        </p>
      ) : (
        <ul className="rounded-[var(--radius-card)] border border-border bg-card/60">
          {contactos.map((c) => (
            <Fila key={c.id} contacto={c} negocioId={negocioId} />
          ))}
        </ul>
      )}
    </div>
  );
}
