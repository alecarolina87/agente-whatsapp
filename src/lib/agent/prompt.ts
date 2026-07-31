import type { Mensaje } from "@/lib/openrouter/client";

import { MARCA_HANDOFF } from "./handoff";

/**
 * Construcción de la conversación que se le manda al modelo.
 *
 * Está separado del resto del motor porque es la parte que más se va a tocar
 * —cada cliente querrá afinar el tono— y porque siendo una función pura se
 * puede probar sin base de datos ni red.
 */

/**
 * Cuántos mensajes anteriores se le pasan al modelo.
 *
 * Cada mensaje del historial se paga en cada llamada, así que no se manda la
 * conversación entera. Veinte da contexto suficiente para que el agente no
 * repita preguntas ya contestadas, sin que una conversación larga dispare el
 * coste de cada respuesta.
 */
export const MENSAJES_DE_CONTEXTO = 20;

/**
 * Instrucciones que se añaden siempre, por debajo de las del cliente.
 *
 * El cliente escribe la personalidad de su agente en `channels.system_prompt`;
 * esto es lo que la plataforma impone pase lo que pase. Va **después** del
 * texto del cliente a propósito: lo último que lee el modelo pesa más, y estas
 * reglas no son negociables.
 */
const REGLAS_DE_LA_PLATAFORMA = [
  "Estás respondiendo por WhatsApp. Escribe como se escribe ahí: mensajes cortos, sin encabezados, sin listas con viñetas y sin markdown.",
  "No inventes precios, horarios, disponibilidad ni condiciones. Si no lo sabes, dilo y ofrece pasar la conversación a una persona.",
  "No prometas resultados médicos, terapéuticos ni de salud.",
  "No pidas datos bancarios ni contraseñas.",
  "Responde en el idioma en que te escriban.",
  /*
   * La regla del handoff. Va con un ejemplo porque sin él los modelos tienden
   * a escribir la marca en medio de la frase o a explicarla al cliente.
   *
   * El texto sí se envía; la marca se quita antes (ver handoff.ts). Y se pide
   * que la respuesta siga siendo útil: un "no puedo ayudarte" a secas deja al
   * cliente colgado mientras espera a que alguien lea el aviso.
   */
  `Si no puedes resolver algo, o te piden hablar con una persona, despídete con naturalidad diciendo que lo pasas al equipo y añade ${MARCA_HANDOFF} al final del mensaje, en una línea aparte. Nunca menciones esa marca ni la expliques.`,
].join("\n");

/** Lo que se usa si el canal todavía no tiene personalidad configurada. */
export const PROMPT_POR_DEFECTO =
  "Eres el asistente de atención al cliente de este negocio. Ayudas a resolver dudas y a concertar citas. Eres directo, cercano y breve.";

export type MensajeHistorial = {
  /** `in` = lo escribió el contacto; `out` = lo enviamos nosotros. */
  direction: "in" | "out";
  text: string | null;
};

export function construirMensajes({
  promptDelCanal,
  historial,
  cuantos = MENSAJES_DE_CONTEXTO,
}: {
  promptDelCanal: string | null | undefined;
  /** De más antiguo a más reciente. */
  historial: MensajeHistorial[];
  /** Cuántos mensajes recientes conservar. Lo fija cada cliente. */
  cuantos?: number;
}): Mensaje[] {
  const personalidad = promptDelCanal?.trim() || PROMPT_POR_DEFECTO;

  const mensajes: Mensaje[] = [
    { role: "system", content: `${personalidad}\n\n${REGLAS_DE_LA_PLATAFORMA}` },
  ];

  for (const m of historial.slice(-cuantos)) {
    const contenido = m.text?.trim();

    // Los adjuntos llegan sin texto. Pasarlos como mensaje vacío confunde al
    // modelo y algunos proveedores lo rechazan, así que se describen.
    const cuerpo = contenido || (m.direction === "in" ? "[el contacto envió un archivo]" : null);
    if (!cuerpo) continue;

    mensajes.push({ role: m.direction === "in" ? "user" : "assistant", content: cuerpo });
  }

  return mensajes;
}
