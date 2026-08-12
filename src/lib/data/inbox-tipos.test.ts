import { describe, expect, it } from "vitest";

import {
  coincideBusqueda,
  necesitaPersona,
  type ConversacionListada,
} from "./inbox-tipos";

const base: ConversacionListada = {
  id: "c1",
  estado: "open",
  iaActiva: true,
  sinLeer: 0,
  ultimoMensajeEn: null,
  ventanaCaducaEn: null,
  contacto: { nombre: "María Pérez", telefono: "+34600112233" },
  ultimoTexto: null,
};

describe("coincideBusqueda", () => {
  it("sin texto, todo coincide", () => {
    expect(coincideBusqueda(base, "")).toBe(true);
    expect(coincideBusqueda(base, "   ")).toBe(true);
  });

  it("busca por nombre sin distinguir mayúsculas", () => {
    expect(coincideBusqueda(base, "maría")).toBe(true);
    expect(coincideBusqueda(base, "PÉREZ")).toBe(true);
    expect(coincideBusqueda(base, "lucía")).toBe(false);
  });

  /*
   * El caso que justifica la comparación por dígitos: el teléfono está
   * guardado como `+34600112233` y nadie lo teclea así. Sin esto, buscar por
   * teléfono solo funcionaría escribiéndolo exactamente igual que lo guardó el
   * sistema — es decir, casi nunca.
   */
  it("encuentra el teléfono aunque se teclee con espacios o guiones", () => {
    expect(coincideBusqueda(base, "600 11 22 33")).toBe(true);
    expect(coincideBusqueda(base, "600-112-233")).toBe(true);
    expect(coincideBusqueda(base, "+34 600 112 233")).toBe(true);
  });

  it("encuentra por un trozo del número", () => {
    expect(coincideBusqueda(base, "112233")).toBe(true);
    expect(coincideBusqueda(base, "999")).toBe(false);
  });

  /*
   * La guarda que evita el desastre silencioso: al buscar «ana», los dígitos de
   * lo tecleado quedan en cadena vacía. Sin comprobarlo, `"".includes("")`
   * devuelve `true` y la búsqueda coincidiría con **todo el mundo** — que es
   * peor que no encontrar nada, porque parece que funciona.
   */
  it("un texto sin dígitos que no está en el nombre no coincide con nadie", () => {
    expect(coincideBusqueda(base, "ana")).toBe(false);
  });

  it("funciona con contactos sin nombre", () => {
    const anonimo = {
      ...base,
      contacto: { nombre: null, telefono: "+34600112233" },
    };

    expect(coincideBusqueda(anonimo, "600112233")).toBe(true);
    expect(coincideBusqueda(anonimo, "maría")).toBe(false);
  });
});

describe("necesitaPersona", () => {
  it("una conversación traspasada espera a alguien", () => {
    expect(necesitaPersona({ ...base, estado: "handoff_pending" })).toBe(true);
  });

  /*
   * El caso silencioso: la IA apagada y mensajes sin leer. No salta ningún
   * aviso, simplemente nadie va a contestar hasta que alguien entre.
   */
  it("la IA parada con mensajes sin leer también espera", () => {
    expect(necesitaPersona({ ...base, iaActiva: false, sinLeer: 2 })).toBe(
      true,
    );
  });

  it("la IA parada sin nada sin leer no espera a nadie", () => {
    expect(necesitaPersona({ ...base, iaActiva: false, sinLeer: 0 })).toBe(
      false,
    );
  });

  it("con la IA contestando no espera a nadie", () => {
    expect(necesitaPersona({ ...base, sinLeer: 5 })).toBe(false);
  });
});
