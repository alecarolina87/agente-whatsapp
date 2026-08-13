import { describe, expect, it } from "vitest";

import {
  ACCIONES,
  DISPARADORES,
  accionesDe,
  admite,
  buscarAccion,
  buscarDisparador,
  configCompleta,
  describirRegla,
} from "./catalogo";

describe("catálogo", () => {
  it("no repite claves", () => {
    const d = DISPARADORES.map((x) => x.clave);
    const a = ACCIONES.map((x) => x.clave);
    expect(new Set(d).size).toBe(d.length);
    expect(new Set(a).size).toBe(a.length);
  });

  /*
   * Un disparador que ofrece una acción inexistente saldría en la pantalla como
   * un desplegable vacío y la regla no se podría crear. Es exactamente el tipo
   * de fallo que aparece al renombrar una acción y olvidar una lista.
   */
  it("todas las acciones que ofrece un disparador existen", () => {
    for (const d of DISPARADORES) {
      for (const clave of d.acciones) {
        expect(buscarAccion(clave), `${d.clave} → ${clave}`).not.toBeNull();
      }
    }
  });

  it("todo disparador ofrece al menos una acción", () => {
    for (const d of DISPARADORES) {
      expect(accionesDe(d.clave).length).toBeGreaterThan(0);
    }
  });

  it("devuelve null si no existe", () => {
    expect(buscarDisparador("inventado")).toBeNull();
    expect(buscarAccion("inventada")).toBeNull();
    expect(accionesDe("inventado")).toEqual([]);
  });
});

describe("admite", () => {
  it("24 h sin respuesta puede mandar una plantilla", () => {
    expect(admite("sin_respuesta", "enviar_plantilla")).toBe(true);
  });

  /*
   * El caso que justifica la comprobación en el servidor. Quien acaba de
   * escribir tiene la ventana abierta y el agente ya le está contestando
   * gratis: mandarle además una plantilla es pagar por duplicar la respuesta.
   */
  it("el primer mensaje no puede mandar una plantilla", () => {
    expect(admite("primer_mensaje", "enviar_plantilla")).toBe(false);
  });

  it("una combinación inventada no se admite", () => {
    expect(admite("inventado", "poner_etiqueta")).toBe(false);
    expect(admite("sin_respuesta", "inventada")).toBe(false);
  });
});

describe("configCompleta", () => {
  const horas = buscarDisparador("sin_respuesta")!.config;
  const etiqueta = buscarAccion("poner_etiqueta")!.config;

  it("con los datos puestos, completa", () => {
    expect(configCompleta(horas, { horas: "24" })).toBe(true);
    expect(configCompleta(etiqueta, { etiqueta: "pendiente" })).toBe(true);
  });

  it("sin nada, no", () => {
    expect(configCompleta(horas, {})).toBe(false);
  });

  it("en blanco no cuenta como puesto", () => {
    expect(configCompleta(etiqueta, { etiqueta: "   " })).toBe(false);
  });

  /*
   * `horas: "0"` haría que el barrido tratara cada conversación como vencida
   * nada más contestarla: un recordatorio inmediato a todo el mundo. El mínimo
   * del catálogo es lo único que lo impide, porque el campo del formulario se
   * puede saltar.
   */
  it("cero horas no vale", () => {
    expect(configCompleta(horas, { horas: "0" })).toBe(false);
  });

  it("un mes de silencio sí, un año no", () => {
    expect(configCompleta(horas, { horas: "720" })).toBe(true);
    expect(configCompleta(horas, { horas: "9000" })).toBe(false);
  });

  it("lo que no es un número no vale", () => {
    expect(configCompleta(horas, { horas: "pronto" })).toBe(false);
    expect(configCompleta(horas, { horas: 24 })).toBe(false);
  });

  // Sin campos que rellenar, siempre está completa: es el caso de
  // «pasar a una persona», que no pide nada.
  it("sin campos, completa", () => {
    expect(configCompleta([], {})).toBe(true);
  });
});

describe("describirRegla", () => {
  it("junta el disparador y la acción", () => {
    expect(describirRegla("sin_respuesta", "enviar_plantilla")).toBe(
      "Se quedó sin contestar → mandar una plantilla",
    );
  });

  // Una regla guardada con algo que ya no está en el catálogo tras un
  // despliegue: el motor la ignora, y aquí se dice para que se pueda borrar.
  it("avisa si la regla usa algo que ya no existe", () => {
    expect(describirRegla("desaparecido", "poner_etiqueta")).toContain(
      "Bórrala",
    );
  });
});
