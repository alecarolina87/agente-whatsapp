"use client";

import { useState, useTransition } from "react";

import {
  guardarFicha,
  proponerDesdeWeb,
  type Ficha,
} from "@/app/app/negocios/[negocioId]/info/acciones";

/**
 * La ficha del negocio: lo que el agente sabe.
 *
 * Está pensada para que se pueda rellenar **en dos minutos o en una tarde**,
 * según el rato que se tenga. Arriba, un cuadro de texto libre donde contarlo
 * todo de corrido; debajo, listas para lo que conviene tener ordenado —precios,
 * preguntas frecuentes, objeciones—.
 *
 * Los dos conviven a propósito: un precio suelto dentro de un párrafo el modelo
 * lo encuentra a veces; en una lista, lo encuentra siempre.
 *
 * Todo se guarda con un botón, no campo a campo. Guardar al vuelo suena
 * moderno y aquí sería peor: al escribir un precio a medias se guardaría «12»
 * durante un segundo, y ese segundo puede caer entre dos mensajes de una
 * clienta.
 */

const CAMPO =
  "w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60";

function Seccion({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
      <div>
        <h2 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {titulo}
        </h2>
        {ayuda && <p className="mt-1.5 text-xs text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Lista de filas que se añaden y se quitan.
 *
 * Genérica porque servicios, preguntas y objeciones son lo mismo por dentro:
 * un array de objetos de texto. Tres componentes casi iguales se habrían
 * separado a la tercera corrección.
 */
function Lista<T extends Record<string, string>>({
  filas,
  onChange,
  vacia,
  campos,
  textoAnadir,
}: {
  filas: T[];
  onChange: (filas: T[]) => void;
  vacia: T;
  campos: { clave: keyof T; etiqueta: string; ancho?: "corto" | "largo" }[];
  textoAnadir: string;
}) {
  return (
    <div className="space-y-3">
      {filas.map((fila, i) => (
        <div
          key={i}
          className="space-y-2 rounded-[var(--radius-control)] border border-border p-3"
        >
          {campos.map(({ clave, etiqueta, ancho }) =>
            ancho === "largo" ? (
              <textarea
                key={String(clave)}
                rows={2}
                value={fila[clave]}
                onChange={(e) => {
                  const copia = [...filas];
                  copia[i] = { ...fila, [clave]: e.target.value };
                  onChange(copia);
                }}
                placeholder={etiqueta}
                aria-label={etiqueta}
                className={`${CAMPO} resize-y`}
              />
            ) : (
              <input
                key={String(clave)}
                value={fila[clave]}
                onChange={(e) => {
                  const copia = [...filas];
                  copia[i] = { ...fila, [clave]: e.target.value };
                  onChange(copia);
                }}
                placeholder={etiqueta}
                aria-label={etiqueta}
                className={CAMPO}
              />
            ),
          )}

          <button
            type="button"
            onClick={() => onChange(filas.filter((_, j) => j !== i))}
            className="dato text-xs text-muted-foreground transition hover:text-destructive"
          >
            Quitar
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...filas, { ...vacia }])}
        className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs transition hover:bg-muted"
      >
        {textoAnadir}
      </button>
    </div>
  );
}

export function FormularioInfo({
  negocioId,
  inicial,
}: {
  negocioId: string;
  inicial: Ficha;
}) {
  const [f, setF] = useState<Ficha>(inicial);
  const [estado, setEstado] = useState<{ error?: string; guardado?: boolean }>({});
  const [pendiente, iniciar] = useTransition();

  const set = <K extends keyof Ficha>(clave: K, valor: Ficha[K]) => {
    setF((v) => ({ ...v, [clave]: valor }));
    setEstado({});
  };

  /*
   * Lo que propone el modelo se guarda aparte hasta que alguien dice que sí.
   * Volcarlo directo en el formulario borraría lo ya escrito sin preguntar, y
   * además nadie revisaría nada: se aceptaría por inercia.
   */
  const [web, setWeb] = useState("");
  const [propuesta, setPropuesta] = useState<{
    ficha: Partial<Ficha>;
    coste: number;
  } | null>(null);
  const [errorWeb, setErrorWeb] = useState<string | null>(null);
  const [leyendo, iniciarLectura] = useTransition();

  function aplicarPropuesta() {
    if (!propuesta) return;

    setF((v) => ({
      ...v,
      ...propuesta.ficha,
      // El texto libre se añade al que hubiera, no lo pisa: lo que escribió una
      // persona vale más que lo que dedujo un modelo.
      texto_libre: [v.texto_libre, propuesta.ficha.texto_libre].filter(Boolean).join("\n\n"),
      servicios: [...v.servicios, ...(propuesta.ficha.servicios ?? [])],
      faqs: [...v.faqs, ...(propuesta.ficha.faqs ?? [])],
      objeciones: [...v.objeciones, ...(propuesta.ficha.objeciones ?? [])],
      web: v.web || web,
    }));
    setPropuesta(null);
    setEstado({});
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-[var(--radius-card)] border border-primary/40 bg-primary/5 p-6">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">
            Empezar desde su web
          </h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Pega la dirección y se lee para proponerte la ficha. Lo revisas antes
            de guardar nada: un modelo leyendo una web se inventa un precio de vez
            en cuando, y eso en una clínica no puede pasar.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={web}
            onChange={(e) => setWeb(e.target.value)}
            placeholder="clinicadentalone.es"
            aria-label="Dirección de la web"
            className={`${CAMPO} dato flex-1`}
          />
          <button
            type="button"
            disabled={leyendo || !web.trim()}
            onClick={() =>
              iniciarLectura(async () => {
                setErrorWeb(null);
                setPropuesta(null);
                const r = await proponerDesdeWeb(negocioId, web);
                if (r.ok) setPropuesta({ ficha: r.ficha, coste: r.costeUsd });
                else setErrorWeb(r.error);
              })
            }
            className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {leyendo ? "Leyendo la web…" : "Leer"}
          </button>
        </div>

        {errorWeb && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            {errorWeb}
          </p>
        )}

        {propuesta && (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-border bg-background p-4">
            <p className="text-sm">
              Encontrado:{" "}
              <span className="dato">
                {propuesta.ficha.servicios?.length ?? 0} servicios ·{" "}
                {propuesta.ficha.faqs?.length ?? 0} preguntas ·{" "}
                {propuesta.ficha.objeciones?.length ?? 0} pegas
              </span>
            </p>

            {propuesta.ficha.texto_libre && (
              <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                {propuesta.ficha.texto_libre.slice(0, 400)}
                {propuesta.ficha.texto_libre.length > 400 ? "…" : ""}
              </p>
            )}

            <p className="dato text-xs text-muted-foreground">
              Coste de la lectura: {propuesta.coste.toFixed(4)} $
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={aplicarPropuesta}
                className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-110"
              >
                Añadir al formulario
              </button>
              <button
                type="button"
                onClick={() => setPropuesta(null)}
                className="rounded-[var(--radius-control)] border border-border px-4 py-2 text-xs transition hover:bg-muted"
              >
                Descartar
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Se añade a lo que ya hay, sin borrar nada. Revísalo abajo y después
              guarda.
            </p>
          </div>
        )}
      </section>

      <Seccion
        titulo="Cuéntalo con tus palabras"
        ayuda="Lo más rápido y lo que más sirve. Qué es el negocio, qué ofrece, cómo trabaja. Con esto solo, el agente ya sabe de qué habla."
      >
        <textarea
          rows={8}
          value={f.texto_libre}
          onChange={(e) => set("texto_libre", e.target.value)}
          aria-label="Información del negocio"
          className={`${CAMPO} resize-y`}
          placeholder={
            "Somos una clínica dental en el centro de Palma, abiertos desde 2014.\n\n" +
            "Lo que más hacemos es ortodoncia invisible e implantes. Trabajamos con " +
            "cita previa y la primera visita de valoración es gratuita.\n\n" +
            "La gente suele preguntar si financiamos: sí, hasta 12 meses sin intereses."
          }
        />
      </Seccion>

      <Seccion
        titulo="Servicios y precios"
        ayuda="Lo que conviene tener ordenado. Un precio dentro de un párrafo el agente lo encuentra a veces; en una lista, siempre."
      >
        <Lista
          filas={f.servicios}
          onChange={(v) => set("servicios", v)}
          vacia={{ nombre: "", descripcion: "", precio: "", duracion: "" }}
          textoAnadir="+ Añadir servicio"
          campos={[
            { clave: "nombre", etiqueta: "Nombre del servicio" },
            { clave: "descripcion", etiqueta: "En qué consiste (opcional)" },
            { clave: "precio", etiqueta: "Precio, o desde cuánto" },
            { clave: "duracion", etiqueta: "Cuánto dura (opcional)" },
          ]}
        />
      </Seccion>

      <Seccion titulo="Dónde y cuándo">
        <div className="grid gap-4 sm:grid-cols-2">
          <input
            value={f.direccion}
            onChange={(e) => set("direccion", e.target.value)}
            placeholder="Dirección"
            aria-label="Dirección"
            className={CAMPO}
          />
          <input
            value={f.zona}
            onChange={(e) => set("zona", e.target.value)}
            placeholder="Zona o ciudad"
            aria-label="Zona"
            className={CAMPO}
          />
        </div>
        <input
          value={f.horarios}
          onChange={(e) => set("horarios", e.target.value)}
          placeholder="L-V de 9 a 14 y de 16 a 20, sábados alternos"
          aria-label="Horarios"
          className={CAMPO}
        />
        <input
          value={f.web}
          onChange={(e) => set("web", e.target.value)}
          placeholder="https://suweb.com"
          aria-label="Web"
          className={`${CAMPO} dato`}
        />
      </Seccion>

      <Seccion
        titulo="Preguntas frecuentes"
        ayuda="Lo que preguntan todos los días. Cada una que pongas aquí es una vez menos que tienes que contestar tú."
      >
        <Lista
          filas={f.faqs}
          onChange={(v) => set("faqs", v)}
          vacia={{ pregunta: "", respuesta: "" }}
          textoAnadir="+ Añadir pregunta"
          campos={[
            { clave: "pregunta", etiqueta: "¿Qué preguntan?" },
            { clave: "respuesta", etiqueta: "Qué se contesta", ancho: "largo" },
          ]}
        />
      </Seccion>

      <Seccion
        titulo="Pegas y cómo responderlas"
        ayuda="Lo que frena a alguien a decidirse: que es caro, que duele, que le pilla lejos. Es lo que más vende y lo que casi nadie escribe."
      >
        <Lista
          filas={f.objeciones}
          onChange={(v) => set("objeciones", v)}
          vacia={{ objecion: "", respuesta: "" }}
          textoAnadir="+ Añadir pega"
          campos={[
            { clave: "objecion", etiqueta: "La pega. Ej: «es caro»" },
            { clave: "respuesta", etiqueta: "Cómo se responde", ancho: "largo" },
          ]}
        />
      </Seccion>

      {/* En su propia tarjeta y en ámbar: no es un campo más de la ficha. */}
      <section className="space-y-3 rounded-[var(--radius-card)] border border-warning/40 bg-warning/5 p-6">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.14em] text-warning uppercase">
            Lo que no puede prometer nunca
          </h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Se le repite al agente al final de todo, que es donde más peso tiene.
            En una clínica o un centro de estética, una promesa de más no es un
            problema de marketing: es una afirmación sanitaria que nadie ha
            supervisado.
          </p>
        </div>

        <textarea
          rows={4}
          value={f.no_prometer}
          onChange={(e) => set("no_prometer", e.target.value)}
          aria-label="Lo que no puede prometer"
          className={`${CAMPO} resize-y`}
          placeholder={
            "No digas nunca que un tratamiento no duele.\n" +
            "No valores fotos ni digas si alguien es buen candidato.\n" +
            "No des plazos de curación."
          }
        />
      </section>

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
          Guardado. El agente ya lo sabe — pruébalo en el chat de prueba.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              setEstado(await guardarFicha(negocioId, f));
            })
          }
          className="rounded-[var(--radius-control)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : "Guardar la ficha"}
        </button>
      </div>
    </div>
  );
}
