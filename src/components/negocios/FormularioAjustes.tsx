"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  guardarAjustes,
  type EstadoAjustes,
} from "@/app/app/negocios/[negocioId]/ajustes/acciones";
import { MODELOS } from "@/lib/agent/catalogo";

/**
 * Todo lo que se puede cambiar de un negocio, repartido en pestañas.
 *
 * Cada campo lleva escrito **qué cuesta subirlo o bajarlo**, no solo qué hace.
 * «Mensajes de contexto: 20» no dice nada; «cada mensaje se paga en cada
 * respuesta» sí, y es lo que hace que la decisión se tome con criterio.
 *
 * ## Las pestañas se ocultan con CSS, no quitándolas del DOM
 *
 * Esto no es un detalle de estilo: **es lo que impide perder datos.** Todo esto
 * es un solo formulario con un solo `submit`, y la acción lee los nueve campos
 * de la misma `FormData`. Si una pestaña oculta dejara de renderizarse, sus
 * campos no llegarían, la validación los vería vacíos y guardar desde la
 * pestaña «Límites» borraría las instrucciones del agente.
 *
 * Por eso `hidden`, y por eso este comentario: es un cambio de una línea que
 * parece inofensivo y no lo es.
 */

const CLASE_CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

type Pestana = "agente" | "modelo" | "limites";

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: "agente", texto: "Su agente" },
  { id: "modelo", texto: "El modelo" },
  { id: "limites", texto: "Límites" },
];

/**
 * En qué pestaña vive cada campo.
 *
 * Existe por un fallo que las pestañas introducen y que no se ve venir: **el
 * navegador no puede enseñar el aviso de un campo obligatorio que está
 * oculto.** Si vacías «cuántos mensajes recuerda», te vas a Límites y le das a
 * guardar, el formulario no se envía, no aparece ningún error y parece que el
 * botón está roto.
 *
 * Con esto, al fallar la validación se salta a la pestaña del campo culpable y
 * el navegador puede señalarlo.
 */
const PESTANA_DEL_CAMPO: Record<string, Pestana> = {
  systemPrompt: "agente",
  respuestaArchivos: "agente",
  mensajesDeContexto: "agente",
  bufferSegundos: "agente",
  modelo: "modelo",
  modeloRespaldo: "modelo",
  topeMensualUsd: "limites",
  topeRespuestasHora: "limites",
};

function Boton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? "Guardando…" : "Guardar cambios"}
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

export function FormularioAjustes({
  negocioId,
  inicial,
}: {
  negocioId: string;
  inicial: {
    nombre: string;
    systemPrompt: string;
    respuestaArchivos: string;
    bufferSegundos: number;
    mensajesDeContexto: number;
    topeMensualUsd: number | null;
    topeRespuestasHora: number;
    modelo: string | null;
    modeloRespaldo: string | null;
  };
}) {
  const [estado, ejecutar] = useActionState<EstadoAjustes, FormData>(
    guardarAjustes.bind(null, negocioId),
    {},
  );
  const [pestana, setPestana] = useState<Pestana>("agente");

  return (
    <form
      action={ejecutar}
      /*
       * `invalid` no burbujea en HTML, pero React lo entrega igual por
       * delegación, así que un solo manejador en el formulario cubre los ocho
       * campos. Salta a la pestaña del campo que falla para que el navegador
       * pueda señalarlo; sin esto, guardar desde otra pestaña no hace nada y no
       * dice por qué.
       */
      onInvalid={(e) => {
        const nombre = (e.target as HTMLInputElement).name;
        const destino = PESTANA_DEL_CAMPO[nombre];
        if (destino) setPestana(destino);
      }}
      className="space-y-5"
    >
      {/*
        El nombre va fuera de las pestañas: no es un ajuste más, es la identidad
        de lo que estás editando. Meterlo dentro de una pestaña obligaría a
        buscarlo para cambiar algo tan básico como cómo se llama el cliente.
      */}
      <section className="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
        <Campo id="nombre" etiqueta="Nombre del negocio">
          <input
            id="nombre"
            name="nombre"
            required
            defaultValue={inicial.nombre}
            className={CLASE_CAMPO}
          />
        </Campo>
      </section>

      <div>
        <div
          role="tablist"
          aria-label="Ajustes del negocio"
          className="flex flex-wrap gap-1 border-b border-border"
        >
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestana === p.id}
              onClick={() => setPestana(p.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
                pestana === p.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.texto}
            </button>
          ))}
        </div>

        {/*
          `hidden` y no `{pestana === "x" && …}`. Ver la nota de arriba: quitar
          una pestaña del DOM haría que guardar desde otra borrara sus campos.
        */}
        <div hidden={pestana !== "agente"} className="space-y-4 pt-5">
          <Campo
            id="systemPrompt"
            etiqueta="Instrucciones"
            ayuda="Qué es el negocio, qué ofrece, cómo habla y qué no debe prometer. Esto es lo que más cambia la calidad de las respuestas."
          >
            <textarea
              id="systemPrompt"
              name="systemPrompt"
              rows={10}
              maxLength={8000}
              defaultValue={inicial.systemPrompt}
              className={`${CLASE_CAMPO} resize-y`}
            />
          </Campo>

          <Campo
            id="respuestaArchivos"
            etiqueta="Qué contesta cuando le mandan una foto"
            ayuda="El agente no ve las imágenes. Nunca opina sobre ellas: avisa con esta frase y pasa la conversación a una persona."
          >
            <input
              id="respuestaArchivos"
              name="respuestaArchivos"
              required
              maxLength={1000}
              defaultValue={inicial.respuestaArchivos}
              className={CLASE_CAMPO}
            />
          </Campo>

          <Campo
            id="mensajesDeContexto"
            etiqueta="Cuántos mensajes recuerda"
            ayuda="Más memoria da mejores respuestas en conversaciones largas, pero cada mensaje se paga en cada respuesta."
          >
            <input
              id="mensajesDeContexto"
              name="mensajesDeContexto"
              type="number"
              min={2}
              max={100}
              required
              defaultValue={inicial.mensajesDeContexto}
              className={`${CLASE_CAMPO} dato max-w-32`}
            />
          </Campo>

          <Campo
            id="bufferSegundos"
            etiqueta="Segundos que espera antes de contestar"
            ayuda="La gente escribe a trozos. Si llega otro mensaje, el reloj se reinicia y contesta una vez a todo. A cero contesta a cada mensaje por separado."
          >
            <input
              id="bufferSegundos"
              name="bufferSegundos"
              type="number"
              min={0}
              max={300}
              required
              defaultValue={inicial.bufferSegundos}
              className={`${CLASE_CAMPO} dato max-w-32`}
            />
          </Campo>
        </div>

        <div hidden={pestana !== "modelo"} className="space-y-4 pt-5">
          <Campo
            id="modelo"
            etiqueta="Modelo"
            ayuda="Es lo que más cambia a la vez la calidad de las respuestas y lo que cuestan. Lo gastado de verdad se ve en la portada."
          >
            <select
              id="modelo"
              name="modelo"
              defaultValue={inicial.modelo ?? ""}
              className={CLASE_CAMPO}
            >
              <option value="">El de la plataforma</option>
              {MODELOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} — {m.coste}
                </option>
              ))}
            </select>
          </Campo>

          {/* La descripción de cada uno, fuera del desplegable: dentro de un
              <option> no cabe y se corta justo donde empieza a servir. */}
          <ul className="space-y-1.5 border-l-2 border-border pl-3 text-xs text-muted-foreground">
            {MODELOS.map((m) => (
              <li key={m.id}>
                <span className="font-medium text-foreground">{m.nombre}:</span>{" "}
                {m.descripcion}
              </li>
            ))}
          </ul>

          <Campo
            id="modeloRespaldo"
            etiqueta="Si ese falla, contesta con"
            ayuda="Los proveedores tienen días malos. Sin respaldo, el agente se calla y la clienta se queda esperando sin que nadie se entere hasta que llama."
          >
            <select
              id="modeloRespaldo"
              name="modeloRespaldo"
              defaultValue={inicial.modeloRespaldo ?? ""}
              className={CLASE_CAMPO}
            >
              <option value="">Nada: se queda sin contestar</option>
              {MODELOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} — {m.coste}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div hidden={pestana !== "limites"} className="space-y-4 pt-5">
          <Campo
            id="topeMensualUsd"
            etiqueta="Tope de gasto al mes, en dólares"
            ayuda="Al llegar, el agente deja de contestar y los mensajes se siguen guardando. Déjalo vacío para no poner tope."
          >
            <input
              id="topeMensualUsd"
              name="topeMensualUsd"
              inputMode="decimal"
              defaultValue={inicial.topeMensualUsd ?? ""}
              placeholder="sin tope"
              className={`${CLASE_CAMPO} dato max-w-40`}
            />
          </Campo>

          <Campo
            id="topeRespuestasHora"
            etiqueta="Máximo de respuestas por hora y contacto"
            ayuda="Protege de un bucle o de alguien insistiendo mucho. Es por contacto, no por negocio: una persona habladora no puede callar al agente para el resto."
          >
            <input
              id="topeRespuestasHora"
              name="topeRespuestasHora"
              type="number"
              min={1}
              max={1000}
              required
              defaultValue={inicial.topeRespuestasHora}
              className={`${CLASE_CAMPO} dato max-w-32`}
            />
          </Campo>
        </div>
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
          Guardado. El agente ya responde con esto.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
          Se dice en voz alta porque con pestañas deja de ser obvio: el botón
          guarda las tres, no solo la que estás mirando. Sin esta línea, cambiar
          algo en dos pestañas y guardar una vez parece que va a perder lo otro.
        */}
        <p className="text-xs text-muted-foreground">
          Guarda las tres pestañas a la vez.
        </p>
        <Boton />
      </div>
    </form>
  );
}
