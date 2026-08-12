import { z } from "zod";

import { normalizarE164 } from "./normalize";

/**
 * Forma de los eventos que envía YCloud, y traducción a lo que entiende
 * nuestro esquema.
 *
 * El contrato está documentado en `SPIKE-ycloud.md` §2 y verificado contra una
 * integración en funcionamiento.
 */

/** Un mensaje de un cliente. */
export const EVENTO_MENSAJE_ENTRANTE = "whatsapp.inbound_message.received";

/**
 * Meta ha revisado una plantilla: la aprueba o la rechaza.
 *
 * Sin esto, la aprobación no llega sola y hay que acordarse de pulsar un botón
 * de sincronizar — que es lo que hace el fork. En la práctica significa que
 * Meta aprueba una plantilla a las dos horas y el negocio se entera al día
 * siguiente, si se acuerda.
 *
 * Contrato en `SPIKE-ycloud.md` §2.c.
 */
export const EVENTO_PLANTILLA_REVISADA = "whatsapp.template.reviewed";

/**
 * Valores que admite `msg_type_enum` en la base de datos.
 *
 * Escritos aquí a mano y no importados: si alguien añade un valor al enum de
 * Postgres sin tocar esta lista, el mapeo de abajo lo delata en un test en vez
 * de fallar en producción con un `22P02`.
 */
export const TIPOS_MENSAJE = [
  "text",
  "audio",
  "image",
  "document",
  "video",
  "template",
  "interactive",
  "system",
] as const;

export type TipoMensaje = (typeof TIPOS_MENSAJE)[number];

/**
 * De los tipos de WhatsApp a los nuestros.
 *
 * No es una tabla de equivalencias burocrática: WhatsApp tiene tipos que
 * nuestro enum no contempla, y un valor fuera del enum hace que el `insert`
 * falle y el mensaje del cliente **se pierda**. Preferimos guardarlo con el
 * tipo más parecido que perderlo.
 */
const EQUIVALENCIAS: Record<string, TipoMensaje> = {
  text: "text",
  audio: "audio",
  voice: "audio", // las notas de voz de WhatsApp llegan como `voice`
  image: "image",
  sticker: "image", // un sticker es una imagen; el enum no tiene sticker
  document: "document",
  video: "video",
  template: "template",
  interactive: "interactive",
  button: "interactive", // respuesta a un botón
  list_reply: "interactive",
  system: "system",
};

export function traducirTipo(tipoYCloud: string | undefined): TipoMensaje {
  if (!tipoYCloud) return "text";
  return EQUIVALENCIAS[tipoYCloud] ?? "text";
}

/** Tipos que traen adjunto en lugar de texto. */
const CON_ADJUNTO = new Set(["audio", "voice", "image", "sticker", "document", "video"]);

/**
 * Esquema del evento. Solo se declara lo que F1 necesita; el resto de campos
 * que manda YCloud se ignoran sin fallar, porque un proveedor puede añadir
 * campos nuevos en cualquier momento y eso no debe romper el webhook.
 */
/**
 * YCloud anida el adjunto bajo una clave con el nombre del tipo:
 * `whatsappInboundMessage.image = { id, link, mimeType, caption }`. Y escribe
 * el tipo MIME de dos formas según el caso, así que se leen las dos.
 */
const esquemaAdjunto = z
  .object({
    id: z.string(),
    link: z.string(),
    mimeType: z.string(),
    mime_type: z.string(),
    caption: z.string(),
    filename: z.string(),
  })
  .partial();

const esquemaEvento = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  createTime: z.string().optional(),
  whatsappInboundMessage: z
    .looseObject({
      wamid: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      type: z.string().optional(),
      text: z.object({ body: z.string() }).partial().optional(),
      customerProfile: z.object({ name: z.string() }).partial().optional(),
      image: esquemaAdjunto.optional(),
      audio: esquemaAdjunto.optional(),
      voice: esquemaAdjunto.optional(),
      video: esquemaAdjunto.optional(),
      document: esquemaAdjunto.optional(),
      sticker: esquemaAdjunto.optional(),
    })
    .optional(),
  /*
   * La plantilla revisada por Meta. Va suelta en la raíz, igual que el mensaje
   * entrante, y **no trae nuestro identificador**: se localiza por nombre e
   * idioma (ver `RevisionPlantilla`).
   */
  whatsappTemplate: z
    .looseObject({
      name: z.string().min(1),
      language: z.string().optional(),
      status: z.string().optional(),
      reason: z.string().nullish(),
    })
    .optional(),
});

/**
 * Lo que Meta dice de una plantilla.
 *
 * **No hay identificador nuestro ni del proveedor en el evento** — solo nombre
 * e idioma. Por eso `(workspace, nombre, idioma)` es único en la tabla: sin esa
 * restricción, una aprobación actualizaría una fila al azar.
 */
export type RevisionPlantilla = {
  eventoId: string;
  nombre: string;
  idioma: string;
  /** Estado tal cual lo manda Meta, sin traducir. */
  estado: string;
  /** Por qué la rechazaron. `null` si la aprobaron. */
  motivo: string | null;
  creadoEn: string;
};

export type AdjuntoEntrante = {
  /** Identificador del archivo en YCloud. */
  id: string | null;
  /** Enlace de descarga. Caduca, así que hay que bajarlo pronto. */
  enlace: string | null;
  mime: string | null;
  /** Nombre original, solo en documentos. */
  nombre: string | null;
};

export type MensajeEntrante = {
  /** Identificador del evento. Es la clave de la deduplicación. */
  eventoId: string;
  /** Identificador del mensaje en Meta. Va a `messages.wamid`. */
  wamid: string;
  /** Quién escribe, en E.164. */
  de: string;
  /** A qué número de la tienda escribe, en E.164. */
  para: string;
  tipo: TipoMensaje;
  /** El texto, o `null` si el mensaje era un adjunto. */
  texto: string | null;
  nombreContacto: string | null;
  /** Momento del evento en ISO. */
  creadoEn: string;
  /** Datos del archivo, si el mensaje traía uno. */
  adjunto: AdjuntoEntrante | null;
};

/**
 * Resultado de mirar un evento.
 *
 * Se distingue "esto no es para mí" de "esto viene roto": lo primero es normal
 * —YCloud manda también eventos de estado de entrega— y merece un `200`. Lo
 * segundo hay que registrarlo, porque significa que el contrato ha cambiado.
 */
export type ResultadoParseo =
  | { clase: "mensaje"; mensaje: MensajeEntrante }
  | { clase: "plantilla_revisada"; revision: RevisionPlantilla }
  | { clase: "ignorado"; motivo: string }
  | { clase: "malformado"; motivo: string };

export function parsearEntrante(cuerpo: unknown): ResultadoParseo {
  const evento = esquemaEvento.safeParse(cuerpo);
  if (!evento.success) {
    return { clase: "malformado", motivo: "el evento no tiene la forma esperada" };
  }

  const {
    id,
    type,
    createTime,
    whatsappInboundMessage: wim,
    whatsappTemplate: plantilla,
  } = evento.data;

  /*
   * Los ecos son los mensajes que hemos enviado nosotros, devueltos por YCloud.
   * Procesarlos haría que el agente se contestara a sí mismo, y cada vuelta
   * costaría una llamada al modelo. Es el freno principal contra el bucle.
   */
  if (type.includes("echo")) {
    return { clase: "ignorado", motivo: "eco de un mensaje saliente" };
  }

  /*
   * Meta ha revisado una plantilla. Va antes del descarte general porque es el
   * único aviso que se recibe: si se ignorara, la plantilla se quedaría
   * «pendiente» para siempre aunque estuviera aprobada, y el negocio no podría
   * usarla sin saber por qué.
   */
  if (type === EVENTO_PLANTILLA_REVISADA) {
    if (!plantilla) {
      return { clase: "malformado", motivo: "falta whatsappTemplate" };
    }

    return {
      clase: "plantilla_revisada",
      revision: {
        eventoId: id,
        nombre: plantilla.name,
        idioma: plantilla.language ?? "es",
        estado: plantilla.status ?? "PENDING",
        motivo: plantilla.reason ?? null,
        creadoEn: createTime ?? new Date().toISOString(),
      },
    };
  }

  // YCloud manda también eventos de estado (enviado, entregado, leído) y otros
  // sobre la cuenta. Ignorarlos es correcto: devolver error haría que YCloud
  // reintentara algo que nunca vamos a querer.
  if (type !== EVENTO_MENSAJE_ENTRANTE) {
    return { clase: "ignorado", motivo: `tipo de evento no tratado: ${type}` };
  }

  if (!wim) {
    return { clase: "malformado", motivo: "falta whatsappInboundMessage" };
  }

  const de = normalizarE164(wim.from);
  const para = normalizarE164(wim.to);

  // Sin remitente normalizable no se sabe de quién es el mensaje, y guardarlo
  // ensuciaría la bandeja con un contacto imposible de identificar.
  if (!de) return { clase: "malformado", motivo: `remitente no normalizable: ${wim.from}` };
  if (!para) return { clase: "malformado", motivo: `destinatario no normalizable: ${wim.to}` };

  const tipoCrudo = wim.type ?? "text";
  const traeAdjunto = CON_ADJUNTO.has(tipoCrudo);

  /*
   * El pie de foto sí es texto del contacto y se conserva: muchas veces es la
   * pregunta de verdad —"¿esto es normal?"— y perderla dejaría al agente
   * respondiendo a una imagen sin contexto.
   */
  const bloque = traeAdjunto
    ? ((wim as Record<string, unknown>)[tipoCrudo] as Record<string, string> | undefined)
    : undefined;

  const texto = traeAdjunto ? (bloque?.caption ?? null) : (wim.text?.body ?? null);

  const adjunto: AdjuntoEntrante | null = traeAdjunto
    ? {
        id: bloque?.id ?? null,
        enlace: bloque?.link ?? null,
        mime: bloque?.mimeType ?? bloque?.mime_type ?? null,
        nombre: bloque?.filename ?? null,
      }
    : null;

  return {
    clase: "mensaje",
    mensaje: {
      eventoId: id,
      wamid: wim.wamid,
      de,
      para,
      tipo: traducirTipo(tipoCrudo),
      texto,
      nombreContacto: wim.customerProfile?.name ?? null,
      creadoEn: createTime ?? new Date().toISOString(),
      adjunto,
    },
  };
}
