"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  coincideBusqueda,
  necesitaPersona,
  type ConversacionListada,
} from "@/lib/data/inbox-tipos";

import { AvisoHandoff, EstadoVentana } from "./EstadoVentana";

/**
 * La lista de conversaciones, con buscador y filtros.
 *
 * ## Por qué filtra en el navegador y no en el servidor
 *
 * Porque la lista vive en el layout, y en Next los layouts **no reciben los
 * parámetros de la URL**. Guardar el filtro en la URL obligaría a mover la
 * lista a la página, y entonces se volvería a pintar en cada clic: se perdería
 * el scroll cada vez que abres una conversación. Con doscientas, eso es
 * inaceptable.
 *
 * El precio está acotado y es honesto: se busca sobre lo que hay cargado, y si
 * hay más, se dice.
 *
 * ## Por qué «te esperan a ti» sigue arriba
 *
 * Es la razón por la que existe esta pantalla. Filtrar no puede romper eso: con
 * cualquier filtro puesto, lo que espera a una persona sigue separado y
 * primero.
 */

type Filtro = "todas" | "esperan" | "ia" | "persona";

const FILTROS: { id: Filtro; texto: string; ayuda: string }[] = [
  { id: "todas", texto: "Todas", ayuda: "Todas las conversaciones abiertas" },
  {
    id: "esperan",
    texto: "Te esperan",
    ayuda: "Traspasadas, o con la IA parada y mensajes sin leer",
  },
  { id: "ia", texto: "Las lleva la IA", ayuda: "El agente está contestando" },
  {
    id: "persona",
    texto: "Las llevas tú",
    ayuda: "La IA está en pausa en esa conversación",
  },
];

export function ListaConversaciones({
  conversaciones,
  total,
}: {
  conversaciones: ConversacionListada[];
  /** Abiertas en total, que pueden ser más de las cargadas. */
  total: number;
}) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(
    () =>
      conversaciones.filter((c) => {
        if (filtro === "esperan" && !necesitaPersona(c)) return false;
        if (filtro === "ia" && !c.iaActiva) return false;
        if (filtro === "persona" && c.iaActiva) return false;

        return coincideBusqueda(c, busqueda);
      }),
    [conversaciones, filtro, busqueda],
  );

  const esperando = visibles.filter(necesitaPersona);
  const alDia = visibles.filter((c) => !necesitaPersona(c));

  const buscando = busqueda.trim().length > 0;
  const hayMasSinCargar = total > conversaciones.length;

  return (
    <>
      <div className="space-y-2 border-b border-border px-4 py-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o teléfono…"
          aria-label="Buscar conversaciones"
          className="w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary"
        />

        <div className="flex flex-wrap gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              title={f.ayuda}
              className={`dato rounded-full px-2.5 py-1 text-[11px] transition ${
                filtro === f.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>

        {/*
          Sin esto, quien busca a alguien de hace tres meses y no lo encuentra
          concluye que no está — cuando lo que pasa es que no se ha cargado.
        */}
        {buscando && hayMasSinCargar && (
          <p className="text-[11px] text-muted-foreground">
            Buscando entre las {conversaciones.length} más recientes de {total}.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversaciones.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Aún no ha escrito nadie. Cuando llegue un WhatsApp, aparecerá aquí.
          </p>
        )}

        {conversaciones.length > 0 && visibles.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {buscando
              ? `Nadie coincide con «${busqueda.trim()}».`
              : "No hay ninguna en este filtro."}
          </p>
        )}

        {esperando.length > 0 && (
          <>
            <Encabezado
              texto="Te esperan a ti"
              cuantas={esperando.length}
              urgente
            />
            <ul>
              {esperando.map((c) => (
                <FilaConversacion key={c.id} c={c} destacada />
              ))}
            </ul>
          </>
        )}

        {alDia.length > 0 && (
          <>
            {/* El segundo encabezado solo aparece si hay algo en el primero:
                con todo al día, una lista a secas se lee mejor. */}
            {esperando.length > 0 && (
              <Encabezado texto="Las lleva el agente" cuantas={alDia.length} />
            )}
            <ul>
              {alDia.map((c) => (
                <FilaConversacion key={c.id} c={c} />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function Encabezado({
  texto,
  cuantas,
  urgente = false,
}: {
  texto: string;
  cuantas: number;
  urgente?: boolean;
}) {
  return (
    <p
      className={`dato sticky top-0 z-10 flex items-center justify-between px-4 py-2 text-[11px] tracking-[0.14em] uppercase backdrop-blur ${
        urgente
          ? "bg-warning/15 text-warning"
          : "bg-background/90 text-muted-foreground"
      }`}
    >
      {texto}
      <span>{cuantas}</span>
    </p>
  );
}

function FilaConversacion({
  c,
  destacada = false,
}: {
  c: ConversacionListada;
  destacada?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/app/inbox/${c.id}`}
        className={`block border-b border-border px-4 py-3 transition hover:bg-muted/60 ${
          // Una línea de color a la izquierda: se distingue de un vistazo sin
          // repintar la fila entera, que cansaría con veinte esperando.
          destacada ? "border-l-2 border-l-warning bg-warning/5" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">
            {c.contacto.nombre ?? c.contacto.telefono}
          </p>
          {c.sinLeer > 0 && (
            <span className="dato rounded-full bg-primary px-1.5 py-0.5 text-[11px] text-primary-foreground">
              {c.sinLeer}
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {c.ultimoTexto ?? "Sin mensajes"}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {c.estado === "handoff_pending" && <AvisoHandoff compacto />}
          <EstadoVentana caducaEn={c.ventanaCaducaEn} compacto />
          {!c.iaActiva && (
            <span className="dato text-[11px] text-muted-foreground">
              IA en pausa
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
