"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import {
  alternarAutomatizacion,
  borrarAutomatizacion,
  crearAutomatizacion,
  type EstadoAutomatizacion,
} from "@/app/app/negocios/[negocioId]/automatizaciones/acciones";
import {
  DISPARADORES,
  accionesDe,
  buscarAccion,
  buscarDisparador,
  describirRegla,
} from "@/lib/automatizaciones/catalogo";
import { HORA_APERTURA, HORA_CIERRE } from "@/lib/automatizaciones/horario";

/**
 * Crear y encender automatizaciones.
 *
 * ## Lo que la pantalla tiene que dejar claro
 *
 * **Que esto le escribe a gente de verdad.** Es la diferencia con el resto de
 * ajustes: equivocarse aquí no rompe una pantalla, le llega a una clienta. Por
 * eso nacen apagadas, por eso el interruptor avisa antes de encender la que
 * manda plantillas, y por eso el horario está escrito donde se lee y no
 * escondido en el código.
 */

const CLASE_CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

type Plantilla = {
  id: string;
  name: string;
  body: string;
  variable_count: number;
};

type Regla = {
  id: string;
  nombre: string;
  activa: boolean;
  disparador: string;
  accion: string;
  config_disparador: Record<string, string> | null;
  config_accion: Record<string, string> | null;
};

function Boton({ etiqueta }: { etiqueta: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Guardando…" : etiqueta}
    </button>
  );
}

/** Un resumen en una línea de lo que hace la regla ya guardada. */
function detalle(regla: Regla, plantillas: Plantilla[]): string {
  const partes: string[] = [];

  const horas = regla.config_disparador?.horas;
  if (horas) partes.push(`tras ${horas} h de silencio`);

  const plantillaId = regla.config_accion?.plantillaId;
  if (plantillaId) {
    const p = plantillas.find((x) => x.id === plantillaId);
    partes.push(p ? `plantilla «${p.name}»` : "plantilla que ya no existe");
  }

  const etiqueta = regla.config_accion?.etiqueta;
  if (etiqueta) partes.push(`etiqueta «${etiqueta}»`);

  return partes.join(" · ");
}

function Ficha({
  regla,
  negocioId,
  plantillas,
}: {
  regla: Regla;
  negocioId: string;
  plantillas: Plantilla[];
}) {
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activa, setActiva] = useState(regla.activa);

  const accion = buscarAccion(regla.accion);
  const avisaAlContacto = accion?.escribeAlContacto ?? false;

  const cambiar = (siguiente: boolean) => {
    /*
     * Solo se pregunta al encender, y solo si escribe a la clienta. Apagar
     * nunca hace daño, y una etiqueta tampoco: preguntar por todo enseña a
     * darle a «aceptar» sin leer, y entonces el aviso deja de servir el día que
     * importa.
     */
    if (siguiente && avisaAlContacto) {
      const seguro = window.confirm(
        "Esta automatización manda mensajes de WhatsApp a tus clientas sin que nadie los revise antes, y cada plantilla se paga. ¿La enciendo?",
      );
      if (!seguro) return;
    }

    setActiva(siguiente);
    setError(null);

    empezar(async () => {
      const r = await alternarAutomatizacion(negocioId, regla.id, siguiente);
      if (r.error) {
        setActiva(!siguiente); // se deshace: no ha cambiado nada en la base
        setError(r.error);
      }
    });
  };

  const borrar = () => {
    if (!window.confirm(`¿Borro «${regla.nombre}»?`)) return;

    empezar(async () => {
      const r = await borrarAutomatizacion(negocioId, regla.id);
      if (r.error) setError(r.error);
    });
  };

  const resumen = detalle(regla, plantillas);

  return (
    <div
      className={`rounded-[var(--radius-card)] border p-5 ${
        activa ? "border-primary/40 bg-primary/5" : "border-border bg-card/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{regla.nombre}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {describirRegla(regla.disparador, regla.accion)}
          </p>
          {resumen && (
            <p className="dato mt-1 text-xs text-muted-foreground">{resumen}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activa}
              disabled={pendiente}
              onChange={(e) => cambiar(e.target.checked)}
            />
            <span>{activa ? "Encendida" : "Apagada"}</span>
          </label>

          <button
            type="button"
            onClick={borrar}
            disabled={pendiente}
            className="text-xs text-muted-foreground underline-offset-2 transition hover:text-destructive hover:underline disabled:opacity-60"
          >
            Borrar
          </button>
        </div>
      </div>

      {avisaAlContacto && activa && (
        <p className="mt-3 text-xs text-muted-foreground">
          Solo escribe entre las {HORA_APERTURA}:00 y las {HORA_CIERRE}:00. Lo
          que caiga fuera de esa franja sale a la mañana siguiente.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Nueva({
  negocioId,
  plantillas,
}: {
  negocioId: string;
  plantillas: Plantilla[];
}) {
  const [estado, ejecutar] = useActionState<EstadoAutomatizacion, FormData>(
    crearAutomatizacion.bind(null, negocioId),
    {},
  );

  const [claveDisparador, setDisparador] = useState(DISPARADORES[0].clave);
  const disparador = buscarDisparador(claveDisparador)!;
  const posibles = accionesDe(claveDisparador);

  const [claveAccion, setAccion] = useState(posibles[0].clave);
  const accion = buscarAccion(claveAccion);

  const [plantillaId, setPlantillaId] = useState("");
  const plantilla = plantillas.find((p) => p.id === plantillaId);

  /*
   * Al cambiar de disparador, la acción elegida puede dejar de valer — mandar
   * una plantilla a quien acaba de escribir, por ejemplo. Se cae a la primera
   * que sí valga en vez de dejar puesta una combinación que el servidor va a
   * rechazar.
   */
  const cambiarDisparador = (clave: string) => {
    setDisparador(clave);
    const nuevas = accionesDe(clave);
    if (!nuevas.some((a) => a.clave === claveAccion)) {
      setAccion(nuevas[0].clave);
    }
  };

  return (
    <form
      action={ejecutar}
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6"
    >
      <h2 className="text-sm font-semibold">Nueva automatización</h2>

      <div className="space-y-1.5">
        <label htmlFor="nombre" className="block text-sm font-medium">
          Nombre
        </label>
        <input
          id="nombre"
          name="nombre"
          required
          maxLength={80}
          placeholder="Recuperar a quien no contesta"
          className={CLASE_CAMPO}
        />
        <p className="text-xs text-muted-foreground">
          Solo para reconocerla en esta lista. No lo ve nadie de fuera.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="disparador" className="block text-sm font-medium">
          Cuándo
        </label>
        <select
          id="disparador"
          name="disparador"
          value={claveDisparador}
          onChange={(e) => cambiarDisparador(e.target.value)}
          className={CLASE_CAMPO}
        >
          {DISPARADORES.map((d) => (
            <option key={d.clave} value={d.clave}>
              {d.nombre}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {disparador.descripcion}
        </p>
      </div>

      {disparador.config.map((campo) => (
        <div key={campo.clave} className="space-y-1.5">
          <label
            htmlFor={`d_${campo.clave}`}
            className="block text-sm font-medium"
          >
            {campo.etiqueta}
          </label>
          <input
            id={`d_${campo.clave}`}
            name={`d_${campo.clave}`}
            type={campo.tipo === "numero" ? "number" : "text"}
            min={campo.min}
            max={campo.max}
            required
            defaultValue={campo.pordefecto}
            placeholder={campo.marcador}
            className={`${CLASE_CAMPO} dato`}
          />
          <p className="text-xs text-muted-foreground">{campo.ayuda}</p>
        </div>
      ))}

      <div className="space-y-1.5">
        <label htmlFor="accion" className="block text-sm font-medium">
          Qué hago
        </label>
        <select
          id="accion"
          name="accion"
          value={claveAccion}
          onChange={(e) => setAccion(e.target.value)}
          className={CLASE_CAMPO}
        >
          {posibles.map((a) => (
            <option key={a.clave} value={a.clave}>
              {a.nombre}
            </option>
          ))}
        </select>
        {accion && (
          <p className="text-xs text-muted-foreground">{accion.descripcion}</p>
        )}
      </div>

      {claveAccion === "enviar_plantilla" &&
        (plantillas.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            Todavía no tienes ninguna plantilla aprobada por Meta. Créala en
            «Plantillas» y vuelve cuando esté aprobada.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <label
                htmlFor="a_plantillaId"
                className="block text-sm font-medium"
              >
                Qué plantilla
              </label>
              <select
                id="a_plantillaId"
                name="a_plantillaId"
                required
                value={plantillaId}
                onChange={(e) => setPlantillaId(e.target.value)}
                className={CLASE_CAMPO}
              >
                <option value="">Elige una…</option>
                {plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Solo salen las aprobadas.
              </p>
            </div>

            {plantilla && (
              <p className="dato rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                {plantilla.body}
              </p>
            )}

            {/* Los huecos van con el mismo texto para todo el mundo: esto se
                envía sin que nadie lo revise, así que no hay de dónde sacar el
                nombre ni la fecha de cada clienta. */}
            {plantilla && plantilla.variable_count > 0 && (
              <div className="space-y-3">
                {Array.from({ length: plantilla.variable_count }, (_, i) => (
                  <div key={i} className="space-y-1.5">
                    <label
                      htmlFor={`a_valor_${i}`}
                      className="block text-sm font-medium"
                    >
                      Hueco {`{{${i + 1}}}`}
                    </label>
                    <input
                      id={`a_valor_${i}`}
                      name="a_valor"
                      required
                      className={`${CLASE_CAMPO} dato`}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Cuidado: este texto es el mismo para todas. Una plantilla con
                  la fecha de la cita no sirve para una automatización.
                </p>
              </div>
            )}
          </>
        ))}

      {accion?.config
        .filter((campo) => campo.tipo !== "plantilla")
        .map((campo) => (
          <div key={campo.clave} className="space-y-1.5">
            <label
              htmlFor={`a_${campo.clave}`}
              className="block text-sm font-medium"
            >
              {campo.etiqueta}
            </label>
            <input
              id={`a_${campo.clave}`}
              name={`a_${campo.clave}`}
              type={campo.tipo === "numero" ? "number" : "text"}
              required
              placeholder={campo.marcador}
              className={`${CLASE_CAMPO} dato`}
            />
            <p className="text-xs text-muted-foreground">{campo.ayuda}</p>
          </div>
        ))}

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
          Creada y apagada. Reléela arriba y enciéndela cuando la veas bien.
        </p>
      )}

      <div className="flex justify-end">
        <Boton etiqueta="Crear apagada" />
      </div>
    </form>
  );
}

export function Automatizaciones({
  negocioId,
  reglas,
  plantillas,
}: {
  negocioId: string;
  reglas: Regla[];
  plantillas: Plantilla[];
}) {
  return (
    <div className="space-y-6">
      {reglas.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-sm text-muted-foreground">
          Todavía no hay ninguna. La primera que suele merecer la pena:{" "}
          <strong className="font-medium text-foreground">
            «se quedó sin contestar» a las 24 h → mandar una plantilla
          </strong>
          . Es la que recupera las conversaciones que se enfriaron.
        </p>
      ) : (
        <div className="space-y-3">
          {reglas.map((regla) => (
            <Ficha
              key={regla.id}
              regla={regla}
              negocioId={negocioId}
              plantillas={plantillas}
            />
          ))}
        </div>
      )}

      <Nueva negocioId={negocioId} plantillas={plantillas} />
    </div>
  );
}
