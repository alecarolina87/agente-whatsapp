"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { crearNegocio, type EstadoAlta } from "@/app/app/negocios/acciones";
import { TIPOS_DE_NEGOCIO, plantillaDe } from "@/lib/agent/plantillas-prompt";
import { ComprobarClaves } from "./ComprobarClaves";

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

  /*
   * El prompt se controla desde React para poder sembrarlo al elegir el tipo de
   * negocio. Con un `defaultValue` no se podría cambiar después sin remontar el
   * campo, y remontarlo perdería lo que ya hubiera escrito.
   */
  const [prompt, setPrompt] = useState("");
  const [tipo, setTipo] = useState("");

  // Para leer los campos al comprobar la clave sin volverlos controlados: aquí
  // no hace falta que React se entere de cada tecla.
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const telefonoRef = useRef<HTMLInputElement>(null);

  function elegirTipo(id: string) {
    const plantilla = plantillaDe(id);

    /*
     * Si ya hay algo escrito, se pregunta. Sembrar encima del trabajo de
     * alguien porque tocó un desplegable es la clase de cosa que hace
     * desconfiar de un formulario.
     */
    if (prompt.trim() && plantilla && !confirm("¿Reemplazo lo que has escrito por la plantilla?")) {
      return;
    }

    setTipo(id);
    if (plantilla) setPrompt(plantilla);
  }

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
            ref={telefonoRef}
            required
            inputMode="tel"
            className={`${CLASE_CAMPO} dato`}
            placeholder="+34600111222"
          />
        </Campo>

        {/* Elegir el tipo siembra el prompt de abajo. Es lo que evita que ese
            campo se quede en blanco para siempre, que es lo que pasa cuando
            alguien se encuentra un cuadro vacío y ninguna pista. */}
        <Campo
          id="tipo"
          etiqueta="¿A qué se dedica?"
          ayuda="Solo sirve para darte un punto de partida en las instrucciones del agente. Luego lo editas."
        >
          <select
            id="tipo"
            value={tipo}
            onChange={(e) => elegirTipo(e.target.value)}
            className={CLASE_CAMPO}
          >
            <option value="">Elige uno…</option>
            {TIPOS_DE_NEGOCIO.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} — {t.descripcion}
              </option>
            ))}
          </select>
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
                ref={apiKeyRef}
                type="password"
                autoComplete="off"
                className={CLASE_CAMPO}
                placeholder="••••••••••••"
              />
            </Campo>

            <ComprobarClaves
              obtenerApiKey={() => apiKeyRef.current?.value ?? ""}
              obtenerTelefono={() => telefonoRef.current?.value ?? ""}
            />

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
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={prompt ? 14 : 6}
            maxLength={8000}
            className={`${CLASE_CAMPO} resize-y`}
            placeholder={
              "Elige arriba a qué se dedica y te relleno esto con un punto de partida.\n\n" +
              "O escríbelo tú: quién es el negocio, cómo habla, qué puede decir y qué no."
            }
          />
        </Campo>

        {/* Los corchetes son un recordatorio visible de lo que hay que cambiar.
            Sin este aviso, se despliega un agente que saluda diciendo
            «[NOMBRE DE LA CLÍNICA]». */}
        {prompt.includes("[") && (
          <p className="rounded-[var(--radius-control)] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Cambia lo que está entre corchetes por los datos reales del negocio
            antes de que empiece a atender.
          </p>
        )}

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
