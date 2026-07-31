import { describe, expect, it } from "vitest";

import {
  MAX_MENSAJES_POR_CONVERSACION,
  VENTANA_HORAS,
  calcularCaducidadVentana,
  puedeEnviarTextoLibre,
  superaLimiteDeMensajes,
} from "./guardrails";

const AHORA = new Date("2026-07-31T12:00:00.000Z");
const HORA = 60 * 60 * 1000;

describe("puedeEnviarTextoLibre", () => {
  it("permite escribir dentro de la ventana", () => {
    const caduca = new Date(AHORA.getTime() + 2 * HORA);
    expect(puedeEnviarTextoLibre(caduca, AHORA)).toEqual({ permitido: true });
  });

  /*
   * El criterio de aceptación del blueprint §18: con la ventana cerrada el
   * agente no envía texto libre. Este es el test que lo comprueba — desde el
   * móvil no se puede provocar, porque cualquier mensaje entrante la reabre.
   */
  it("se abstiene con la ventana cerrada", () => {
    const caduca = new Date(AHORA.getTime() - 1 * HORA);
    expect(puedeEnviarTextoLibre(caduca, AHORA)).toEqual({
      permitido: false,
      motivo: "ventana_cerrada",
    });
  });

  it("se abstiene justo en el instante de caducar", () => {
    expect(puedeEnviarTextoLibre(AHORA, AHORA)).toEqual({
      permitido: false,
      motivo: "ventana_cerrada",
    });
  });

  /*
   * Ante la duda, callar. Equivocarse callando cuesta un mensaje; equivocarse
   * hablando puede costar el número de WhatsApp del cliente.
   */
  describe("no da por buena una ventana que no conoce", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["cadena vacía", ""],
      ["fecha inválida", "el martes que viene"],
    ])("%s", (_caso, valor) => {
      expect(puedeEnviarTextoLibre(valor, AHORA)).toEqual({
        permitido: false,
        motivo: "ventana_desconocida",
      });
    });
  });

  it("acepta la fecha como texto ISO, que es como llega de Postgres", () => {
    const caduca = new Date(AHORA.getTime() + HORA).toISOString();
    expect(puedeEnviarTextoLibre(caduca, AHORA)).toEqual({ permitido: true });
  });
});

describe("calcularCaducidadVentana", () => {
  it("abre la ventana 24 horas desde el mensaje entrante", () => {
    const caduca = calcularCaducidadVentana(AHORA);
    expect(new Date(caduca).getTime() - AHORA.getTime()).toBe(VENTANA_HORAS * HORA);
  });

  /* Un mensaje entrante siempre deja la ventana abierta: es lo que hace que
     responder a alguien que acaba de escribir esté siempre permitido. */
  it("la ventana que abre está siempre abierta al abrirla", () => {
    expect(puedeEnviarTextoLibre(calcularCaducidadVentana(AHORA), AHORA)).toEqual({
      permitido: true,
    });
  });
});

describe("superaLimiteDeMensajes", () => {
  it("deja pasar una conversación normal", () => {
    expect(superaLimiteDeMensajes(0)).toBe(false);
    expect(superaLimiteDeMensajes(MAX_MENSAJES_POR_CONVERSACION - 1)).toBe(false);
  });

  it("corta al llegar al tope", () => {
    expect(superaLimiteDeMensajes(MAX_MENSAJES_POR_CONVERSACION)).toBe(true);
    expect(superaLimiteDeMensajes(MAX_MENSAJES_POR_CONVERSACION + 100)).toBe(true);
  });
});
