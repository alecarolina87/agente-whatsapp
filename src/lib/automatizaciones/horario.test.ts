import { describe, expect, it } from "vitest";

import { esHoraDecente, horaLocal } from "./horario";

/**
 * El fallo que estos tests vigilan no rompe nada: manda el mensaje
 * perfectamente, a las tres de la mañana. Se ve en la reacción de la clienta,
 * no en un log.
 */
describe("horaLocal", () => {
  /*
   * El servidor corre en UTC. En verano Madrid va dos horas por delante, así
   * que un `getHours()` a secas creería que son las siete cuando son las nueve
   * — y ese error hace salir mensajes a las siete de la mañana.
   */
  it("cuenta el desfase de verano", () => {
    // 07:30 UTC en julio = 09:30 en Madrid.
    expect(horaLocal(new Date("2026-07-15T07:30:00Z"))).toBe(9);
  });

  it("cuenta el desfase de invierno", () => {
    // 08:30 UTC en enero = 09:30 en Madrid.
    expect(horaLocal(new Date("2026-01-15T08:30:00Z"))).toBe(9);
  });

  // `Intl` en español escribe la medianoche como «24», no como «0».
  it("la medianoche es la hora 0 y no la 24", () => {
    expect(horaLocal(new Date("2026-01-15T23:10:00Z"))).toBe(0);
  });
});

describe("esHoraDecente", () => {
  it("a media mañana, sí", () => {
    expect(esHoraDecente(new Date("2026-07-15T09:00:00Z"))).toBe(true); // 11:00
  });

  it("a las once y media de la noche, no", () => {
    // El caso real: la clienta preguntó el precio a esta hora, y el
    // recordatorio de 24 h heredaría la hora.
    expect(esHoraDecente(new Date("2026-07-15T21:30:00Z"))).toBe(false); // 23:30
  });

  it("a las siete de la mañana, tampoco", () => {
    expect(esHoraDecente(new Date("2026-07-15T05:00:00Z"))).toBe(false); // 07:00
  });

  it("las nueve en punto ya vale", () => {
    expect(esHoraDecente(new Date("2026-01-15T08:00:00Z"))).toBe(true); // 09:00
  });

  it("las nueve de la noche ya no", () => {
    expect(esHoraDecente(new Date("2026-01-15T20:00:00Z"))).toBe(false); // 21:00
  });
});
