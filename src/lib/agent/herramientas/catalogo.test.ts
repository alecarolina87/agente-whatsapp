import { describe, expect, it } from "vitest";

import { HERRAMIENTAS, buscarHerramienta, estaCompleta } from "./catalogo";

describe("catálogo de herramientas", () => {
  it("no tiene claves repetidas", () => {
    const claves = HERRAMIENTAS.map((h) => h.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  /*
   * Las claves viajan a OpenRouter como nombres de función. Un espacio o un
   * acento hace que el proveedor rechace la petición entera — y no fallaría al
   * guardar la configuración, sino la primera vez que una clienta escribe.
   */
  it("las claves valen como nombre de función", () => {
    for (const h of HERRAMIENTAS) {
      expect(h.clave).toMatch(/^[a-z0-9_]{1,64}$/);
    }
  });

  it("cada herramienta dice al modelo cuándo usarla", () => {
    for (const h of HERRAMIENTAS) {
      expect(h.paraElModelo.length).toBeGreaterThan(40);
    }
  });

  it("encuentra por clave y devuelve null si no está", () => {
    expect(buscarHerramienta("enlace_de_reservas")?.nombre).toBe(
      "Dar el enlace de reservas",
    );
    expect(buscarHerramienta("inventada")).toBeNull();
  });
});

describe("estaCompleta", () => {
  const reservas = buscarHerramienta("enlace_de_reservas")!;

  it("con su configuración, está lista", () => {
    expect(
      estaCompleta(reservas, { enlace: "https://citas.ejemplo.com" }),
    ).toBe(true);
  });

  /*
   * El caso que justifica la comprobación: activada pero sin enlace. Si pasara
   * el filtro, el modelo llamaría a la herramienta, recibiría un hueco y le
   * daría a la clienta una dirección inventada — que es peor que decir «no lo sé».
   */
  it("sin configurar, no está lista", () => {
    expect(estaCompleta(reservas, {})).toBe(false);
  });

  it("un valor en blanco no cuenta como configurado", () => {
    expect(estaCompleta(reservas, { enlace: "   " })).toBe(false);
  });

  it("un valor que no es texto tampoco", () => {
    expect(estaCompleta(reservas, { enlace: 42 })).toBe(false);
  });
});
