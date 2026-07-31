import { describe, expect, it } from "vitest";

import { MARCA_HANDOFF, evaluarHandoff, pideHablarConUnaPersona } from "./handoff";

describe("evaluarHandoff", () => {
  it("no pasa a nadie en una conversación normal", () => {
    expect(
      evaluarHandoff({
        respuestaDelModelo: "¡Claro! Tenemos hueco el jueves por la tarde.",
        ultimoMensajeDelContacto: "¿tenéis cita esta semana?",
      }),
    ).toEqual({
      texto: "¡Claro! Tenemos hueco el jueves por la tarde.",
      motivo: null,
    });
  });

  /*
   * El test más importante del archivo: la marca **nunca** puede llegar al
   * cliente. Ver "[HANDOFF]" en un WhatsApp destroza la ilusión de que hay un
   * negocio serio al otro lado.
   */
  describe("la marca nunca llega al cliente", () => {
    it.each([
      ["en su propia línea", `No tengo ese dato.\n\n${MARCA_HANDOFF}`],
      ["pegada al final", `No tengo ese dato. ${MARCA_HANDOFF}`],
      ["al principio", `${MARCA_HANDOFF}\nNo tengo ese dato.`],
      ["repetida", `${MARCA_HANDOFF} No tengo ese dato. ${MARCA_HANDOFF}`],
    ])("%s", (_caso, respuesta) => {
      const r = evaluarHandoff({ respuestaDelModelo: respuesta });

      expect(r.texto).not.toContain("HANDOFF");
      expect(r.texto).toContain("No tengo ese dato.");
      expect(r.motivo).toBe("el_agente_se_rinde");
    });
  });

  it("no deja huecos raros al quitar la marca", () => {
    const r = evaluarHandoff({
      respuestaDelModelo: `Te paso con el equipo.\n\n\n${MARCA_HANDOFF}\n\n`,
    });

    expect(r.texto).toBe("Te paso con el equipo.");
  });

  /*
   * Lo que pide el contacto pesa más que lo que decida el modelo. "Quiero
   * hablar con una persona" es la petición más clara que existe y no debe
   * depender de que un modelo acierte.
   */
  it("lo que pide el contacto manda sobre el modelo", () => {
    const r = evaluarHandoff({
      respuestaDelModelo: "¡Claro que sí! Te ayudo yo encantado.",
      ultimoMensajeDelContacto: "prefiero hablar con una persona",
    });

    expect(r.motivo).toBe("lo_pide_el_contacto");
  });
});

describe("pideHablarConUnaPersona", () => {
  it.each([
    "quiero hablar con una persona",
    "Necesito HABLAR CON ALGUIEN por favor",
    "pásame con un responsable",
    "pasame con soporte",
    "¿me atiende alguien de verdad?",
    "quiero un humano",
  ])("reconoce: %s", (frase) => {
    expect(pideHablarConUnaPersona(frase)).toBe(true);
  });

  /*
   * Los falsos positivos también importan: pasar a una persona cada vez que
   * alguien dice "persona" haría el agente inútil, y una lista demasiado
   * ansiosa es peor que una lista corta.
   */
  it.each([
    "hola, ¿qué tal?",
    "soy una persona muy ocupada",
    "necesito una cita",
    "¿hay alguien de guardia los sábados?",
    "",
    null,
    undefined,
  ])("no salta con: %s", (frase) => {
    expect(pideHablarConUnaPersona(frase)).toBe(false);
  });

  it("funciona sin tildes", () => {
    expect(pideHablarConUnaPersona("pasame con alguien")).toBe(true);
  });
});
