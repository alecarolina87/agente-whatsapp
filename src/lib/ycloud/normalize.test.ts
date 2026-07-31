import { describe, expect, it } from "vitest";

import { normalizarE164, normalizarE164OFallar } from "./normalize";

const ESPERADO = "+34662552851";

describe("normalizarE164", () => {
  /*
   * El test que justifica que esta función exista: las cinco formas en que
   * puede llegar el mismo teléfono tienen que acabar en el mismo texto. Si
   * alguna se escapa, el índice único de `contacts` la admite como contacto
   * nuevo y el historial de esa persona se parte.
   */
  it("colapsa todas las formas del mismo número en una sola", () => {
    const formas = [
      "+34662552851",
      "34662552851",
      "0034662552851",
      "+34 662 55 28 51",
      "+34-662-552-851",
      " +34 (662) 552.851 ",
      "662552851",
    ];

    const normalizadas = new Set(formas.map((f) => normalizarE164(f)));

    expect(normalizadas).toEqual(new Set([ESPERADO]));
  });

  it("respeta un prefijo de país distinto para los números nacionales", () => {
    expect(normalizarE164("612345678", { prefijoPais: "39" })).toBe("+39612345678");
  });

  it("no toca el prefijo si el número ya viene internacional", () => {
    expect(normalizarE164("+393331234567", { prefijoPais: "34" })).toBe("+393331234567");
  });

  describe("devuelve null cuando no hay número válido", () => {
    it.each([
      ["vacío", ""],
      ["null", null],
      ["undefined", undefined],
      ["solo texto", "no soy un teléfono"],
      ["solo símbolos", "+++"],
      ["demasiado corto", "+3466"],
      ["más de 15 dígitos", "+3466255285112345"],
      ["empieza por cero", "+0034662552851"],
    ])("%s", (_caso, entrada) => {
      expect(normalizarE164(entrada)).toBeNull();
    });
  });

  /*
   * `00` es el prefijo internacional europeo, no parte del número. Si no se
   * quitara, quedaría "+0034…", que empieza por cero y ningún país tiene
   * prefijo cero: sería un número inválido que además parece válido.
   */
  it("convierte el 00 internacional en +", () => {
    expect(normalizarE164("0034662552851")).toBe(ESPERADO);
    expect(normalizarE164("00393331234567")).toBe("+393331234567");
  });
});

describe("normalizarE164OFallar", () => {
  it("devuelve el número cuando es válido", () => {
    expect(normalizarE164OFallar("34662552851")).toBe(ESPERADO);
  });

  /*
   * En el webhook es preferible un error ruidoso a un contacto basura: si no se
   * sabe de quién es el mensaje, guardarlo igualmente ensucia la bandeja del
   * cliente y esconde el problema.
   */
  it("lanza un error cuando no se puede normalizar", () => {
    expect(() => normalizarE164OFallar("pepito")).toThrow(/no normalizable/i);
  });
});
