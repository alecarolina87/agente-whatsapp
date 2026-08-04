import { describe, expect, it } from "vitest";

import { describirNegocio } from "./info-negocio";

describe("describirNegocio", () => {
  /*
   * El caso que más importa: sin ficha, no se añade nada. Un bloque con
   * epígrafes vacíos —«SERVICIOS:» seguido de nada— le dice al modelo que ese
   * negocio no tiene servicios, y a partir de ahí contesta que no ofrece nada.
   */
  it("devuelve null cuando no hay nada que contar", () => {
    expect(describirNegocio(null)).toBeNull();
    expect(describirNegocio(undefined)).toBeNull();
    expect(describirNegocio({})).toBeNull();
    expect(describirNegocio({ descripcion: "   ", servicios: [], faqs: [] })).toBeNull();
  });

  it("no saca epígrafes de listas que solo traen huecos", () => {
    const texto = describirNegocio({
      descripcion: "Clínica dental en Palma.",
      servicios: [{ nombre: "  " }, {}],
      faqs: [{ pregunta: "¿Y esto?" }], // sin respuesta
    });

    expect(texto).toContain("EL NEGOCIO");
    expect(texto).not.toContain("SERVICIOS");
    expect(texto).not.toContain("PREGUNTAS FRECUENTES");
  });

  it("pone un servicio por línea con sus detalles", () => {
    const texto = describirNegocio({
      servicios: [
        { nombre: "Limpieza dental", precio: "60 €", duracion: "45 min" },
        { nombre: "Ortodoncia invisible", descripcion: "Alineadores transparentes" },
      ],
    });

    expect(texto).toContain("- Limpieza dental — 60 € · 45 min");
    expect(texto).toContain("- Ortodoncia invisible — Alineadores transparentes");
  });

  /*
   * Sin la frase que las presenta, el modelo trata las objeciones como más
   * preguntas frecuentes y las suelta sin venir a cuento.
   */
  it("presenta las objeciones diciendo cuándo usarlas", () => {
    const texto = describirNegocio({
      objeciones: [{ objecion: "Es caro", respuesta: "Se puede financiar en 12 meses." }],
    });

    expect(texto).toContain("SI TE PONEN ALGUNA DE ESTAS PEGAS");
    expect(texto).toContain("«Es caro» → Se puede financiar en 12 meses.");
  });

  /*
   * Lo último que lee el modelo pesa más, así que lo prohibido va al final
   * pase lo que pase. Si un día se reordenan los bloques, este test lo caza.
   */
  it("deja lo prohibido en último lugar", () => {
    const texto = describirNegocio({
      descripcion: "Centro de estética.",
      servicios: [{ nombre: "Micropigmentación" }],
      faqs: [{ pregunta: "¿Duele?", respuesta: "Se aplica anestesia tópica." }],
      no_prometer: "Nunca digas que no duele ni valores fotos.",
    })!;

    const posicion = texto.indexOf("NO PROMETAS NUNCA");
    expect(posicion).toBeGreaterThan(-1);
    // Nada después salvo el propio bloque.
    expect(texto.slice(posicion)).toContain("Nunca digas que no duele");
    expect(texto.indexOf("EL NEGOCIO")).toBeLessThan(posicion);
    expect(texto.indexOf("SERVICIOS")).toBeLessThan(posicion);
    expect(texto.indexOf("PREGUNTAS FRECUENTES")).toBeLessThan(posicion);
  });

  /*
   * El texto libre es el camino corto: con solo eso, el agente ya sabe de qué
   * va el negocio. Si dejara de inyectarse, un cliente que solo rellenó ese
   * cuadro tendría un agente que no sabe nada, sin que nada lo delatara.
   */
  it("con solo el texto libre ya hay contexto, y va primero", () => {
    const texto = describirNegocio({
      texto_libre: "Somos una clínica dental en Palma. Llevamos 12 años.",
      descripcion: "Clínica dental.",
    })!;

    expect(texto.startsWith("Somos una clínica dental en Palma.")).toBe(true);
    // Sin epígrafe: es la explicación, no una sección más.
    expect(texto).not.toContain("TEXTO LIBRE");
  });

  it("junta dirección y zona en una sola línea", () => {
    const texto = describirNegocio({ direccion: "Carrer de la Mar 12", zona: "Palma centro" });
    expect(texto).toContain("Carrer de la Mar 12 · Palma centro");
  });
});
