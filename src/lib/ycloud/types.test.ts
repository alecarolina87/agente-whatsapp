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
      from: "34600000000",
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
        de: "+34600000000",
        para: "+34600111222",
        tipo: "text",
        texto: "Hola, ¿tenéis cita esta semana?",
        nombreContacto: "Javier",
        creadoEn: "2026-07-31T10:00:00.000Z",
        adjunto: null,
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

  describe("adjuntos", () => {
    /*
     * El caso real: una clienta manda una foto de sus cejas para que Ale las
     * evalúe. Si el enlace no se extrae, la foto se pierde —los enlaces de
     * YCloud caducan— y en la bandeja queda un mensaje vacío.
     */
    it("saca el enlace y el tipo de una imagen", () => {
      const resultado = parsearEntrante(
        eventoDe(
          {},
          {
            type: "image",
            text: undefined,
            image: {
              id: "media_123",
              link: "https://api.ycloud.com/v2/whatsapp/media/media_123",
              mimeType: "image/jpeg",
            },
          },
        ),
      );

      expect(resultado).toMatchObject({
        clase: "mensaje",
        mensaje: {
          tipo: "image",
          adjunto: {
            id: "media_123",
            enlace: "https://api.ycloud.com/v2/whatsapp/media/media_123",
            mime: "image/jpeg",
            nombre: null,
          },
        },
      });
    });

    /*
     * El pie de foto suele ser la pregunta de verdad: «¿esto es normal?». Sin
     * él, el agente contestaría a una imagen sin saber qué se le pregunta.
     */
    it("conserva el pie de foto como texto del mensaje", () => {
      const resultado = parsearEntrante(
        eventoDe(
          {},
          { type: "image", text: undefined, image: { link: "x", caption: "¿esto es normal?" } },
        ),
      );

      expect(resultado).toMatchObject({
        clase: "mensaje",
        mensaje: { texto: "¿esto es normal?" },
      });
    });

    it("guarda el nombre original de un documento", () => {
      const resultado = parsearEntrante(
        eventoDe({}, { type: "document", document: { link: "x", filename: "consentimiento.pdf" } }),
      );

      expect(resultado).toMatchObject({
        clase: "mensaje",
        mensaje: { tipo: "document", adjunto: { nombre: "consentimiento.pdf" } },
      });
    });

    // YCloud escribe el MIME de las dos formas según el endpoint; se leen ambas.
    it("acepta mime_type además de mimeType", () => {
      const resultado = parsearEntrante(
        eventoDe({}, { type: "audio", audio: { link: "x", mime_type: "audio/ogg" } }),
      );

      expect(resultado).toMatchObject({
        clase: "mensaje",
        mensaje: { tipo: "audio", adjunto: { mime: "audio/ogg" } },
      });
    });

    /*
     * Un adjunto sin enlace no se puede descargar, pero el mensaje sí se
     * guarda: en la bandeja tiene que verse que la clienta mandó algo, aunque
     * no se haya podido recuperar.
     */
    it("no se rompe si el adjunto viene sin enlace", () => {
      const resultado = parsearEntrante(eventoDe({}, { type: "image", text: undefined }));

      expect(resultado).toMatchObject({
        clase: "mensaje",
        mensaje: { tipo: "image", texto: null, adjunto: { enlace: null } },
      });
    });

    // Un sticker se guarda como imagen, pero su adjunto vive bajo `sticker`.
    it("encuentra el adjunto de un sticker aunque se guarde como imagen", () => {
      const resultado = parsearEntrante(
        eventoDe({}, { type: "sticker", text: undefined, sticker: { link: "https://s/1.webp" } }),
      );

      expect(resultado).toMatchObject({
        clase: "mensaje",
        mensaje: { tipo: "image", adjunto: { enlace: "https://s/1.webp" } },
      });
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

describe("plantillas revisadas por Meta", () => {
  const evento = (extra: Record<string, unknown> = {}) => ({
    id: "evt_1",
    type: "whatsapp.template.reviewed",
    createTime: "2026-08-12T10:00:00Z",
    whatsappTemplate: {
      wabaId: "waba_1",
      name: "recordatorio_de_cita",
      language: "es",
      status: "APPROVED",
      ...extra,
    },
  });

  it("reconoce la aprobación", () => {
    const r = parsearEntrante(evento());

    expect(r.clase).toBe("plantilla_revisada");
    if (r.clase !== "plantilla_revisada") return;

    expect(r.revision.nombre).toBe("recordatorio_de_cita");
    expect(r.revision.idioma).toBe("es");
    expect(r.revision.estado).toBe("APPROVED");
    expect(r.revision.motivo).toBeNull();
  });

  /*
   * El motivo del rechazo es lo único que dice qué arreglar. Perderlo obliga a
   * adivinar por qué Meta dijo que no, que es exactamente lo que hace que la
   * gente reenvíe la misma plantilla tres veces.
   */
  it("conserva el motivo cuando la rechazan", () => {
    const r = parsearEntrante(evento({ status: "REJECTED", reason: "INVALID_FORMAT" }));

    expect(r.clase).toBe("plantilla_revisada");
    if (r.clase !== "plantilla_revisada") return;

    expect(r.revision.estado).toBe("REJECTED");
    expect(r.revision.motivo).toBe("INVALID_FORMAT");
  });

  it("un evento de plantilla sin plantilla está malformado, no ignorado", () => {
    const r = parsearEntrante({ id: "evt_2", type: "whatsapp.template.reviewed" });

    // Ignorarlo dejaría la plantilla «pendiente» para siempre sin dejar rastro.
    expect(r.clase).toBe("malformado");
  });

  it("los otros eventos de plantilla se ignoran, no rompen", () => {
    const r = parsearEntrante({
      id: "evt_3",
      type: "whatsapp.template.quality_updated",
      whatsappTemplate: { name: "x", language: "es" },
    });

    expect(r.clase).toBe("ignorado");
  });
});
