"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { crearNegocio, type EstadoAlta } from "@/app/app/negocios/acciones";

/**
 * El alta de un cliente.
 *
 * Está partido en tres bloques —el negocio, su WhatsApp, su agente— porque un
 * formulario de nueve campos seguidos intimida y hace abandonar. Solo los dos
 * primeros campos son obligatorios: se puede dar de alta un negocio en veinte
 * segundos y terminar de configurarlo después.
 *
 * Las claves de YCloud son `type="password"` no por secretismo, sino porque se
 * pegan desde el panel de otro proveedor y quedarían a la vista de cualquiera
 * que pase por detrás. Una vez enviadas van a Vault y **no se vuelven a
 * mostrar nunca**, ni aquí ni en los ajustes.
 */

function Boton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Creando…" : "Dar de alta"}
    </button>
  );
}

function Campo({
  id,
  etiqueta,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {etiqueta}
      </label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

const CLASE_CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

export function FormularioAlta() {
  const [estado, ejecutar] = useActionState<EstadoAlta, FormData>(crearNegocio, {});

  // Conectar el WhatsApp es opcional, y por defecto va plegado: el camino
  // corto tiene que parecer corto.
  const [conectarAhora, setConectarAhora] = useState(false);

  return (
    <form action={ejecutar} className="space-y-6">
      <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          El negocio
        </h2>

        <Campo id="nombre" etiqueta="Nombre">
          <input
            id="nombre"
            name="nombre"
            required
            minLength={2}
            maxLength={80}
            className={CLASE_CAMPO}
            placeholder="Estética Ale"
          />
        </Campo>

        <Campo
          id="telefono"
          etiqueta="Número de WhatsApp"
          ayuda="Con el prefijo del país y el +. Es el número al que escriben sus clientas."
        >
          <input
            id="telefono"
            name="telefono"
            required
            inputMode="tel"
            className={`${CLASE_CAMPO} dato`}
            placeholder="+34600111222"
          />
        </Campo>
      </section>

      <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Su WhatsApp
          </h2>
          <button
            type="button"
            onClick={() => setConectarAhora((v) => !v)}
            className="dato text-xs text-primary transition hover:underline"
          >
            {conectarAhora ? "Lo conecto más tarde" : "Conectarlo ahora"}
          </button>
        </div>

        {conectarAhora ? (
          <>
            <p className="text-xs text-muted-foreground">
              Las dos claves están en la cuenta de YCloud del cliente. Van juntas:
              una sirve para enviar y la otra para comprobar que los mensajes que
              llegan son de verdad. Se guardan cifradas y no se vuelven a mostrar.
            </p>

            <Campo id="apiKey" etiqueta="API Key de YCloud">
              <input
                id="apiKey"
                name="apiKey"
                type="password"
                autoComplete="off"
                className={CLASE_CAMPO}
                placeholder="••••••••••••"
              />
            </Campo>

            <Campo id="webhookSecret" etiqueta="Webhook Secret de YCloud">
              <input
                id="webhookSecret"
                name="webhookSecret"
                type="password"
                autoComplete="off"
                className={CLASE_CAMPO}
                placeholder="••••••••••••"
              />
            </Campo>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            El negocio se crea igual y queda listo para configurar. Hasta que
            conectes su WhatsApp{" "}
            <span className="text-foreground">no recibirá mensajes</span>.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Su agente
        </h2>

        <Campo
          id="systemPrompt"
          etiqueta="Cómo tiene que comportarse"
          ayuda="Qué es el negocio, qué ofrece, cómo habla y qué no debe prometer. Puedes dejarlo en blanco y escribirlo después."
        >
          <textarea
            id="systemPrompt"
            name="systemPrompt"
            rows={6}
            maxLength={8000}
            className={`${CLASE_CAMPO} resize-y`}
            placeholder={
              "Eres quien atiende el WhatsApp de un centro de micropigmentación en Palma.\n" +
              "Hablas de tú, con cercanía y sin tecnicismos.\n" +
              "Puedes informar de servicios, precios y disponibilidad.\n" +
              "No das consejos médicos ni valoras resultados: eso lo ve una persona."
            }
          />
        </Campo>

        <Campo
          id="respuestaArchivos"
          etiqueta="Qué contesta cuando le mandan una foto"
          ayuda="El agente no ve las imágenes, así que nunca opina sobre ellas: avisa y te pasa la conversación. Si lo dejas en blanco se usa un texto neutro."
        >
          <input
            id="respuestaArchivos"
            name="respuestaArchivos"
            maxLength={1000}
            className={CLASE_CAMPO}
            placeholder="Gracias por la foto, en un ratito la miro bien y te digo."
          />
        </Campo>
      </section>

      {estado?.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {estado.error}
        </p>
      )}

      <div className="flex justify-end">
        <Boton />
      </div>
    </form>
  );
}
