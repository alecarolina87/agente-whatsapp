import { describe, expect, it } from "vitest";

import { EVENTO_MENSAJE_ENTRANTE, TIPOS_MENSAJE, parsearEntrante, traducirTipo } from "./types";

/** Un evento como los que manda YCloud, con lo mínimo que nos importa. */
function eventoDe(cambios: Record<string, unknown> = {}, mensaje: Record<string, unknown> = {}) {
  return {
    id: "evt_abc123",
    type: EVENTO_MENSAJE_ENTRANTE,
    createTime: "2026-07-31T10:00:00.000Z",
    whatsappInboundMessage: {
      wamid: "wamid.HBgL",
      from: "34662552851",
      to: "34600111222",
      type: "text",
      text: { body: "Hola, ¿tenéis cita esta semana?" },
      customerProfile: { name: "Javier" },
      ...mensaje,
    },
    ...cambios,
  };
}

describe("parsearEntrante", () => {
  it("extrae un mensaje de texto y normaliza los dos números", () => {
    const resultado = parsearEntrante(eventoDe());

    expect(resultado).toEqual({
      clase: "mensaje",
      mensaje: {
        eventoId: "evt_abc123",
        wamid: "wamid.HBgL",
        de: "+34662552851",
        para: "+34600111222",
        tipo: "text",
        texto: "Hola, ¿tenéis cita esta semana?",
        nombreContacto: "Javier",
        creadoEn: "2026-07-31T10:00:00.000Z",
      },
    });
  });

  /*
   * El caso que evita que el agente entre en bucle: nuestra propia respuesta
   * vuelve como eco, y si se procesara dispararía otra respuesta, y otra, cada
   * una pagando una llamada al modelo.
   */
  it("ignora los ecos de los mensajes salientes", () => {
    const resultado = parsearEntrante(eventoDe({ type: "whatsapp.inbound_message.echo" }));

    expect(resultado).toEqual({
      clase: "ignorado",
      motivo: "eco de un mensaje saliente",
    });
  });

  it("ignora los eventos de estado de entrega", () => {
    const resultado = parsearEntrante(eventoDe({ type: "whatsapp.message.updated" }));

    expect(resultado.clase).toBe("ignorado");
  });

  it("no se rompe si YCloud añade campos nuevos", () => {
    const resultado = parsearEntrante(
      eventoDe({ campoQueNoExistiaAyer: { anidado: true } }, { otroCampoNuevo: 42 }),
    );

    expect(resultado.clase).toBe("mensaje");
  });

  describe("marca como malformado lo que no se puede procesar", () => {
    it("un cuerpo que no es un evento", () => {
      expect(parsearEntrante({ cualquier: "cosa" }).clase).toBe("malformado");
      expect(parsearEntrante(null).clase).toBe("malformado");
      expect(parsearEntrante("texto suelto").clase).toBe("malformado");
    });

    it("un evento de mensaje sin el mensaje dentro", () => {
      const { whatsappInboundMessage: _fuera, ...sinMensaje } = eventoDe();
      expect(parsearEntrante(sinMensaje)).toEqual({
        clase: "malformado",
        motivo: "falta whatsappInboundMessage",
      });
    });

    it("un remitente que no es un teléfono", () => {
      const resultado = parsearEntrante(eventoDe({}, { from: "no-soy-un-numero" }));
      expect(resultado.clase).toBe("malformado");
    });
  });

  it("deja el texto en null cuando el mensaje es un adjunto", () => {
    const resultado = parsearEntrante(eventoDe({}, { type: "image", text: undefined }));

    expect(resultado).toMatchObject({
      clase: "mensaje",
      mensaje: { tipo: "image", texto: null },
    });
  });

  it("pone la hora actual si el evento no trae createTime", () => {
    const { createTime: _fuera, ...sinFecha } = eventoDe();
    const resultado = parsearEntrante(sinFecha);

    expect(resultado.clase).toBe("mensaje");
    if (resultado.clase !== "mensaje") return;
    expect(Number.isNaN(Date.parse(resultado.mensaje.creadoEn))).toBe(false);
  });
});

describe("traducirTipo", () => {
  /*
   * Este test es el que protege de un fallo caro: si YCloud manda un tipo que
   * el enum de Postgres no conoce, el `insert` falla con 22P02 y el mensaje del
   * cliente se pierde sin que nadie se entere.
   */
  it("nunca devuelve un valor fuera del enum de la base de datos", () => {
    const tiposDeWhatsApp = [
      "text", "audio", "voice", "image", "sticker", "document", "video",
      "template", "interactive", "button", "list_reply", "system",
      "location", "contacts", "order", "reaction", "inventado",
    ];

    for (const tipo of tiposDeWhatsApp) {
      expect(TIPOS_MENSAJE).toContain(traducirTipo(tipo));
    }
  });

  it("traduce los casos que el enum no contempla", () => {
    expect(traducirTipo("voice")).toBe("audio"); // nota de voz
    expect(traducirTipo("sticker")).toBe("image"); // no hay sticker en el enum
    expect(traducirTipo("button")).toBe("interactive");
    expect(traducirTipo("location")).toBe("text"); // desconocido → el más neutro
    expect(traducirTipo(undefined)).toBe("text");
  });
});
