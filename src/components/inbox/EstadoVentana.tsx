"use client";

import { useSyncExternalStore } from "react";

/**
 * Estado de la ventana de 24 h de Meta.
 *
 * Es el dato más importante de la pantalla y por eso se ve siempre, no
 * escondido en un menú: mientras está abierta se puede escribir libremente, y
 * cuando se cierra hace falta una plantilla aprobada. Quien atiende necesita
 * saberlo *antes* de escribir, no cuando le falla el envío.
 *
 * ## Por qué es un componente de cliente
 *
 * Porque el tiempo pasa. Una insignia calculada en el servidor diría «quedan
 * 2 h» para siempre, y a la hora estaría mintiendo — justo en el momento en que
 * el dato importa más. Aquí se recalcula cada minuto.
 *
 * El primer render, antes de montar, no sabe qué hora es: pintar `Date.now()`
 * en el servidor y otro valor en el cliente provocaría un desajuste de
 * hidratación. Por eso arranca en un estado neutro y se rellena al montar.
 *
 * Se avisa a partir de las 2 horas restantes: es el margen razonable para
 * cerrar una conversación que se estaba enfriando antes de perder el derecho a
 * escribir.
 */

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const UMBRAL_AVISO = 2 * HORA;

/**
 * El reloj, leído como lo que es: una fuente de datos de fuera de React.
 *
 * `useSyncExternalStore` está hecho justo para esto. Con `useState` en un
 * efecto habría dos problemas: React avisa de renders en cascada, y en el
 * servidor no hay reloj que valga porque el resultado se renderiza una vez y se
 * queda congelado.
 *
 * La foto se redondea al minuto a propósito. `getSnapshot` tiene que devolver
 * el mismo valor mientras nada cambie; si devolviera `Date.now()` a pelo, cada
 * llamada daría un número distinto y React entraría en un bucle de renders.
 */
function suscribirAlReloj(avisar: () => void) {
  const id = setInterval(avisar, MINUTO);
  return () => clearInterval(id);
}

const ahoraRedondeado = () => Math.floor(Date.now() / MINUTO) * MINUTO;

/** En el servidor no se sabe qué hora será cuando se pinte. */
const sinRelojEnElServidor = () => null;

export function EstadoVentana({
  caducaEn,
  compacto = false,
}: {
  caducaEn: string | null;
  compacto?: boolean;
}) {
  const ahora = useSyncExternalStore(
    suscribirAlReloj,
    ahoraRedondeado,
    sinRelojEnElServidor,
  );

  const { texto, clase, ayuda } = calcular(caducaEn, ahora);

  return (
    <span
      className={`dato inline-flex items-center rounded-full px-2.5 py-1 text-xs ${clase}`}
      title={ayuda}
    >
      {compacto ? texto.replace("Ventana abierta · ", "") : texto}
    </span>
  );
}

/**
 * ¿Está cerrada la ventana ahora mismo?
 *
 * Comparte el reloj con la insignia a propósito: si cada uno mirara la hora por
 * su cuenta, podrían discrepar durante un minuto — la insignia diciendo
 * «cerrada» y el cuadro de texto dejando escribir, o al revés. Un minuto basta
 * para mandar un mensaje que Meta rechaza.
 *
 * Una ventana **desconocida** cuenta como cerrada, igual que en el servidor: no
 * saber si se puede escribir no es permiso para hacerlo.
 *
 * @returns `null` en el render del servidor, donde todavía no hay reloj.
 */
export function useVentanaCerrada(caducaEn: string | null): boolean | null {
  const ahora = useSyncExternalStore(
    suscribirAlReloj,
    ahoraRedondeado,
    sinRelojEnElServidor,
  );

  if (ahora === null) return null;
  if (!caducaEn) return true;

  const restante = new Date(caducaEn).getTime() - ahora;
  return Number.isNaN(restante) || restante <= 0;
}

function calcular(caducaEn: string | null, ahora: number | null) {
  const ayuda = caducaEn
    ? `Se puede escribir libremente hasta ${new Date(caducaEn).toLocaleString("es-ES")}`
    : "No hay constancia del último mensaje del contacto";

  if (!caducaEn) {
    return { texto: "Ventana desconocida", clase: "bg-muted text-muted-foreground", ayuda };
  }

  // Render del servidor: todavía no hay reloj, así que no se afirma nada.
  if (ahora === null) {
    return { texto: "Ventana", clase: "bg-muted text-muted-foreground", ayuda };
  }

  const restante = new Date(caducaEn).getTime() - ahora;

  if (Number.isNaN(restante)) {
    return { texto: "Ventana desconocida", clase: "bg-muted text-muted-foreground", ayuda };
  }

  if (restante <= 0) {
    return { texto: "Ventana cerrada", clase: "bg-destructive/15 text-destructive", ayuda };
  }

  if (restante <= UMBRAL_AVISO) {
    return {
      texto: `Quedan ${formatear(restante)}`,
      clase: "bg-warning/15 text-warning",
      ayuda,
    };
  }

  return {
    texto: `Ventana abierta · ${formatear(restante)}`,
    clase: "bg-success/15 text-success",
    ayuda,
  };
}

/**
 * Aviso de que esta conversación espera a una persona.
 *
 * Se pinta en ámbar y no en rojo a propósito: no es un error, es una tarea
 * pendiente. El rojo se reserva para lo que está roto.
 */
export function AvisoHandoff({ compacto = false }: { compacto?: boolean }) {
  return (
    <span
      className="dato inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning"
      title="El agente pidió ayuda o el contacto pidió hablar con una persona"
    >
      <span aria-hidden="true">!</span>
      {compacto ? "Handoff" : "Espera a una persona"}
    </span>
  );
}

function formatear(ms: number) {
  const horas = Math.floor(ms / HORA);
  const minutos = Math.floor((ms % HORA) / 60_000);
  return horas > 0 ? `${horas} h ${minutos} min` : `${minutos} min`;
}
