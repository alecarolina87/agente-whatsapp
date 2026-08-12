"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import {
  borrarPlantilla,
  enviarARevisar,
  guardarBorrador,
  reconciliarEstados,
  type EstadoAccion,
} from "@/app/app/negocios/[negocioId]/plantillas/acciones";
import { EXPLICACION, type Plantilla } from "@/lib/plantillas/estados";

/**
 * Escribir plantillas, mandarlas a Meta y ver en qué punto está cada una.
 *
 * ## Lo que esta pantalla tiene que dejar clarísimo
 *
 * Que **esto no se envía a nadie todavía**. Una plantilla se escribe, la revisa
 * Meta, y solo entonces sirve. Quien no entienda eso escribirá una y esperará a
 * que pase algo.
 */

const CLASE_CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

const TONO = {
  ok: "border-success/40 bg-success/10 text-success",
  espera: "border-border bg-muted text-muted-foreground",
  mal: "border-warning/40 bg-warning/10 text-warning",
} as const;

function Boton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Guardando…" : "Guardar plantilla"}
    </button>
  );
}

function Ficha({
  plantilla,
  negocioId,
}: {
  plantilla: Plantilla;
  negocioId: string;
}) {
  const [trabajando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const explicacion = EXPLICACION[plantilla.status];
  const enviable = plantilla.status === "local" || plantilla.status === "rejected";

  return (
    <li className="rounded-[var(--radius-card)] border border-border bg-card/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="dato text-sm font-medium">{plantilla.name}</p>
          <p className="dato mt-0.5 text-xs text-muted-foreground">
            {plantilla.category} · {plantilla.language}
            {plantilla.variable_count > 0 && ` · ${plantilla.variable_count} variables`}
          </p>
        </div>

        <span
          className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs ${TONO[explicacion.tono]}`}
        >
          {explicacion.texto}
        </span>
      </div>

      {plantilla.header_text && (
        <p className="mt-3 text-sm font-medium">{plantilla.header_text}</p>
      )}
      <p className="mt-1 text-sm whitespace-pre-wrap">{plantilla.body}</p>
      {plantilla.footer_text && (
        <p className="mt-1 text-xs text-muted-foreground">{plantilla.footer_text}</p>
      )}

      {/* El motivo del rechazo es lo único que dice qué arreglar. Sin él, la
          reacción normal es reenviar la misma plantilla y esperar otra cosa. */}
      {plantilla.rejection_reason && (
        <p className="mt-3 rounded-[var(--radius-control)] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Meta la rechazó por: {plantilla.rejection_reason}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {enviable && (
          <button
            type="button"
            disabled={trabajando}
            onClick={() =>
              iniciar(async () => {
                setError(null);
                const r = await enviarARevisar(negocioId, plantilla.id);
                if (r.error) setError(r.error);
              })
            }
            className="rounded-[var(--radius-control)] border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary transition hover:bg-primary/15 disabled:opacity-50"
          >
            {trabajando ? "Enviando a Meta…" : "Enviar a revisar"}
          </button>
        )}

        {/*
          En dos pasos, y no por burocracia: una plantilla aprobada costó días
          de espera de Meta. Quitarla de aquí no la borra de Meta, pero sí deja
          de poder usarse desde la plataforma — y volver a tenerla es escribirla
          otra vez y esperar otra revisión.
        */}
        {confirmando ? (
          <>
            <button
              type="button"
              disabled={trabajando}
              onClick={() =>
                iniciar(async () => {
                  setError(null);
                  const r = await borrarPlantilla(negocioId, plantilla.id);
                  if (r.error) setError(r.error);
                })
              }
              className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition hover:bg-destructive/15 disabled:opacity-50"
            >
              {trabajando ? "Quitando…" : "Sí, quitarla"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              Mejor no
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={trabajando}
            onClick={() => setConfirmando(true)}
            className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            Quitar de aquí
          </button>
        )}
      </div>

      {confirmando && (
        <p className="mt-2 text-xs text-muted-foreground">
          Se quita solo de esta plataforma; en Meta sigue existiendo.
          {plantilla.status === "approved" &&
            " Estaba aprobada: para volver a usarla habría que escribirla otra vez y esperar una nueva revisión."}
        </p>
      )}
    </li>
  );
}

export function Plantillas({
  negocioId,
  plantillas,
  conectado,
}: {
  negocioId: string;
  plantillas: Plantilla[];
  conectado: boolean;
}) {
  const [estado, ejecutar] = useActionState<EstadoAccion, FormData>(
    guardarBorrador.bind(null, negocioId),
    {},
  );
  const [sincronizando, iniciarSync] = useTransition();
  const [avisoSync, setAvisoSync] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {!conectado && (
        <p className="rounded-[var(--radius-card)] border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
          Este negocio todavía no tiene conectadas sus claves de YCloud. Puedes
          escribir plantillas, pero no se pueden mandar a revisar hasta que lo esté.
        </p>
      )}

      <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Escribir una plantilla
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Esto no le llega a nadie todavía. Se escribe aquí, la revisa Meta —de
            minutos a un par de días— y solo cuando la aprueban se puede usar.
          </p>
        </div>

        <form action={ejecutar} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="nombre" className="block text-sm font-medium">
              Nombre
            </label>
            <input
              id="nombre"
              name="nombre"
              required
              placeholder="recordatorio de cita"
              className={CLASE_CAMPO}
            />
            <p className="text-xs text-muted-foreground">
              Es interno: lo ves tú, no la clienta. Meta solo acepta minúsculas,
              números y guiones bajos, así que si escribes otra cosa se ajusta solo.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="categoria" className="block text-sm font-medium">
              Para qué es
            </label>
            <select id="categoria" name="categoria" defaultValue="utility" className={CLASE_CAMPO}>
              <option value="utility">Aviso o gestión — recordar una cita, confirmar algo</option>
              <option value="marketing">Promoción — ofertas, novedades</option>
              <option value="authentication">Código de verificación</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Meta es mucho más estricta con las de promoción, y al cliente le
              cuestan más caras. Si es un recordatorio, no lo marques como promoción.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cabecera" className="block text-sm font-medium">
              Título <span className="text-muted-foreground">(opcional)</span>
            </label>
            <input id="cabecera" name="cabecera" maxLength={60} className={CLASE_CAMPO} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cuerpo" className="block text-sm font-medium">
              Mensaje
            </label>
            <textarea
              id="cuerpo"
              name="cuerpo"
              rows={5}
              required
              maxLength={1024}
              placeholder="Hola {{1}}, te recordamos tu cita del {{2}}. Si no puedes venir, contéstanos a este mensaje."
              className={`${CLASE_CAMPO} resize-y`}
            />
            <p className="text-xs text-muted-foreground">
              Con <code className="dato">{"{{1}}"}</code>,{" "}
              <code className="dato">{"{{2}}"}</code>… dejas huecos que se rellenan
              al enviar: el nombre, la fecha. Cuidado: hay que dar un valor para
              cada hueco, o Meta rechaza el mensaje entero.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pie" className="block text-sm font-medium">
              Pie <span className="text-muted-foreground">(opcional, 60 caracteres)</span>
            </label>
            <input id="pie" name="pie" maxLength={60} className={CLASE_CAMPO} />
          </div>

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
              Guardada. {estado.aviso ?? "Cuando quieras, mándala a revisar."}
            </p>
          )}

          <div className="flex justify-end">
            <Boton />
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Sus plantillas
          </h2>

          {/*
            El estado llega solo por webhook en cuanto Meta revisa. Este botón
            es el respaldo: si un aviso se perdiera, sin esto la plantilla se
            quedaría «pendiente» para siempre.
          */}
          {conectado && plantillas.length > 0 && (
            <button
              type="button"
              disabled={sincronizando}
              onClick={() =>
                iniciarSync(async () => {
                  setAvisoSync(null);
                  const r = await reconciliarEstados(negocioId);
                  setAvisoSync(r.error ?? r.aviso ?? null);
                })
              }
              className="dato text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              {sincronizando ? "Preguntando a YCloud…" : "Volver a comprobar el estado"}
            </button>
          )}
        </div>

        {avisoSync && (
          <p
            role="status"
            className="rounded-[var(--radius-control)] border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
          >
            {avisoSync}
          </p>
        )}

        {plantillas.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-border bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
            Todavía no hay ninguna. Sin plantillas aprobadas, este negocio no puede
            escribir a nadie que lleve más de 24 h sin contestar.
          </p>
        ) : (
          <ul className="space-y-3">
            {plantillas.map((p) => (
              <Ficha key={p.id} plantilla={p} negocioId={negocioId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
