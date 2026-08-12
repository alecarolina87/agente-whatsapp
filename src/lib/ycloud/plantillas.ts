import "server-only";

import { ErrorYCloud } from "./client";
import { normalizarE164 } from "./normalize";

/**
 * Plantillas de WhatsApp en YCloud.
 *
 * Contrato verificado en `SPIKE-ycloud.md` §2.c, contra la documentación de
 * YCloud del 12/08/2026. Aquí solo va lo que habla con el proveedor; qué se
 * guarda y cómo se enseña vive en la capa de datos y en las pantallas.
 *
 * ## Por qué existe, en una frase
 *
 * Meta solo deja escribir texto libre durante 24 h desde el último mensaje del
 * cliente. Pasado ese plazo, esto es lo único que se puede enviar.
 */

const BASE = "https://api.ycloud.com/v2";
const TIMEOUT_MS = 15_000;

/**
 * Nombre válido para Meta: minúsculas, números y guiones bajos.
 *
 * Es la trampa más fácil de esta API. «Recordatorio de cita» no vale, y el
 * fallo no aparece al escribirla: aparece al enviarla, cuando ya nadie
 * relaciona una cosa con la otra.
 */
export const NOMBRE_VALIDO = /^[a-z0-9_]{1,512}$/;

/**
 * Convierte un título escrito por una persona en un nombre que Meta acepta.
 *
 * Se ofrece como sugerencia en el formulario, no se aplica a la fuerza: quien
 * escribe la plantilla tiene que ver el nombre real, porque es el que aparecerá
 * en los mensajes de error de Meta.
 */
export function sugerirNombre(titulo: string): string {
  return titulo
    .toLowerCase()
    .normalize("NFD")
    // Quita los acentos: `á` → `a`. Meta no los acepta.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

/**
 * Cuenta las variables `{{1}}`, `{{2}}`… del cuerpo.
 *
 * Importa más de lo que parece: al enviar hay que dar **exactamente** tantos
 * valores como variables tenga. Con menos, Meta rechaza el mensaje entero y la
 * clienta no recibe nada.
 *
 * Devuelve el número más alto encontrado, no cuántas hay: un cuerpo con
 * `{{1}}` y `{{3}}` necesita tres valores aunque solo aparezcan dos huecos.
 */
export function contarVariables(cuerpo: string): number {
  const encontradas = [...cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) =>
    Number(m[1]),
  );
  return encontradas.length === 0 ? 0 : Math.max(...encontradas);
}

export type Categoria = "utility" | "marketing" | "authentication";

export type Boton =
  | { tipo: "respuesta_rapida"; texto: string }
  | { tipo: "url"; texto: string; url: string }
  | { tipo: "telefono"; texto: string; telefono: string };

export type BorradorPlantilla = {
  nombre: string;
  idioma: string;
  categoria: Categoria;
  cabecera?: string | null;
  cuerpo: string;
  pie?: string | null;
  botones?: Boton[];
};

/**
 * Traduce un botón nuestro al formato de YCloud.
 *
 * Se hace aquí y no en la base de datos para que el formato del proveedor no se
 * cuele en nuestras tablas: el día que cambie —o que haya un segundo
 * proveedor—, esto es lo único que se toca.
 */
function botonAYCloud(boton: Boton) {
  switch (boton.tipo) {
    case "respuesta_rapida":
      return { type: "QUICK_REPLY", text: boton.texto };
    case "url":
      return { type: "URL", text: boton.texto, url: boton.url };
    case "telefono":
      return { type: "PHONE_NUMBER", text: boton.texto, phone_number: boton.telefono };
  }
}

/** Construye el cuerpo de la petición tal y como lo espera YCloud. */
export function construirComponentes(borrador: BorradorPlantilla) {
  const componentes: Record<string, unknown>[] = [];

  if (borrador.cabecera?.trim()) {
    componentes.push({ type: "HEADER", format: "TEXT", text: borrador.cabecera.trim() });
  }

  // El cuerpo es el único obligatorio para Meta.
  componentes.push({ type: "BODY", text: borrador.cuerpo });

  if (borrador.pie?.trim()) {
    componentes.push({ type: "FOOTER", text: borrador.pie.trim() });
  }

  if (borrador.botones?.length) {
    componentes.push({ type: "BUTTONS", buttons: borrador.botones.map(botonAYCloud) });
  }

  return componentes;
}

async function pedir(
  ruta: string,
  apiKey: string,
  opciones: RequestInit = {},
): Promise<unknown> {
  let respuesta: Response;

  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      ...opciones,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        ...(opciones.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    throw new ErrorYCloud(`No se pudo contactar con YCloud: ${motivo}`, null);
  }

  const cuerpo = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    /*
     * El mensaje de YCloud se enseña tal cual a quien está creando la
     * plantilla. Es feo, pero es información de verdad: dice qué campo está
     * mal. Un «error al crear la plantilla» genérico obliga a adivinar.
     */
    const detalle =
      (cuerpo as { error?: { message?: string } } | null)?.error?.message ??
      JSON.stringify(cuerpo)?.slice(0, 300) ??
      "";

    throw new ErrorYCloud(
      `YCloud respondió ${respuesta.status}: ${detalle}`,
      respuesta.status,
    );
  }

  return cuerpo;
}

/**
 * Busca el identificador de la cuenta de WhatsApp Business a partir del número.
 *
 * Hace falta para crear plantillas y **no se guarda** a propósito: es un dato
 * derivado del número, y guardarlo abre la puerta a que se quede desfasado si
 * el cliente cambia de cuenta. Cuesta una llamada; la alternativa cuesta un
 * fallo raro dentro de seis meses.
 */
export async function buscarWabaId({
  apiKey,
  telefono,
}: {
  apiKey: string;
  telefono: string;
}): Promise<string> {
  const cuerpo = (await pedir("/whatsapp/phoneNumbers?limit=100", apiKey)) as {
    items?: { phoneNumber?: string; wabaId?: string }[];
  } | null;

  const items = cuerpo?.items ?? [];
  const buscado = normalizarE164(telefono);

  const encontrado = items.find(
    (n) => n.phoneNumber && normalizarE164(n.phoneNumber) === buscado,
  );

  /*
   * Si el número no aparece, **no** se cae al primero de la lista. El fork lo
   * hace, y es un fallo silencioso esperando a pasar: mandaría la plantilla a
   * la cuenta equivocada, y el negocio no entendería por qué su plantilla está
   * aprobada en un sitio donde no puede usarla.
   */
  if (!encontrado?.wabaId) {
    throw new ErrorYCloud(
      `El número ${buscado} no está en esta cuenta de YCloud, así que no se sabe a qué cuenta de WhatsApp mandar la plantilla.`,
      404,
    );
  }

  return encontrado.wabaId;
}

export type RespuestaCreacion = {
  /** Identificador en el proveedor. Sirve para trazar, no para buscar. */
  id: string | null;
  /** Estado inicial, casi siempre `PENDING`. */
  estado: string;
};

/**
 * Manda la plantilla a Meta a través de YCloud.
 *
 * Lo que devuelve **no** es «aprobada»: es «recibida». Meta la revisa después,
 * y el resultado llega por el webhook (`whatsapp.template.reviewed`).
 */
export async function crearPlantilla({
  apiKey,
  wabaId,
  borrador,
}: {
  apiKey: string;
  wabaId: string;
  borrador: BorradorPlantilla;
}): Promise<RespuestaCreacion> {
  if (!NOMBRE_VALIDO.test(borrador.nombre)) {
    throw new ErrorYCloud(
      `El nombre «${borrador.nombre}» no vale: Meta solo acepta minúsculas, números y guiones bajos.`,
      400,
    );
  }

  const cuerpo = (await pedir("/whatsapp/templates", apiKey, {
    method: "POST",
    body: JSON.stringify({
      wabaId,
      name: borrador.nombre,
      language: borrador.idioma,
      // YCloud las quiere en mayúsculas; nosotros las guardamos en minúsculas.
      category: borrador.categoria.toUpperCase(),
      components: construirComponentes(borrador),
    }),
  })) as { officialTemplateId?: string; id?: string; status?: string } | null;

  return {
    id: cuerpo?.officialTemplateId ?? cuerpo?.id ?? null,
    estado: cuerpo?.status ?? "PENDING",
  };
}

export type PlantillaDelProveedor = {
  nombre: string;
  idioma: string;
  estado: string;
  motivoRechazo: string | null;
  idProveedor: string | null;
};

/**
 * Lista las plantillas de la cuenta. Es el respaldo del webhook.
 *
 * Hace falta aunque los avisos lleguen bien: si un evento se pierde —el
 * endpoint caído, un despliegue a mitad—, sin una forma de reconciliar la
 * plantilla se queda «pendiente» para siempre y nadie sabe por qué.
 */
export async function listarPlantillas({
  apiKey,
  wabaId,
}: {
  apiKey: string;
  wabaId: string;
}): Promise<PlantillaDelProveedor[]> {
  const cuerpo = (await pedir(
    `/whatsapp/templates?limit=100&filter.wabaId=${encodeURIComponent(wabaId)}`,
    apiKey,
  )) as {
    items?: {
      name?: string;
      language?: string;
      status?: string;
      reason?: string;
      officialTemplateId?: string;
    }[];
  } | null;

  return (cuerpo?.items ?? []).flatMap((p) =>
    p.name
      ? [
          {
            nombre: p.name,
            idioma: p.language ?? "es",
            estado: p.status ?? "PENDING",
            motivoRechazo: p.reason ?? null,
            idProveedor: p.officialTemplateId ?? null,
          },
        ]
      : [],
  );
}

/**
 * Envía una plantilla aprobada a un contacto.
 *
 * **Esto se salta la ventana de 24 h**, que es justamente para lo que existe.
 * Quien llama es responsable de que la plantilla esté aprobada: mandar una que
 * no lo está hace que Meta rechace el mensaje.
 */
export async function enviarPlantilla({
  apiKey,
  desde,
  hacia,
  nombre,
  idioma,
  valores,
}: {
  apiKey: string;
  desde: string;
  hacia: string;
  nombre: string;
  idioma: string;
  /** Un valor por cada `{{n}}` del cuerpo, en orden. */
  valores: string[];
}): Promise<{ wamid: string | null; id: string | null; status: string | null }> {
  const componentes = valores.length
    ? [
        {
          type: "body",
          parameters: valores.map((v) => ({ type: "text", text: v })),
        },
      ]
    : undefined;

  const cuerpo = (await pedir("/whatsapp/messages", apiKey, {
    method: "POST",
    body: JSON.stringify({
      type: "template",
      from: desde,
      to: hacia,
      template: {
        name: nombre,
        language: { code: idioma },
        ...(componentes ? { components: componentes } : {}),
      },
    }),
  })) as { wamid?: string; id?: string; status?: string } | null;

  return {
    wamid: cuerpo?.wamid ?? null,
    id: cuerpo?.id ?? null,
    status: cuerpo?.status ?? null,
  };
}

/**
 * Traduce el estado que manda Meta al nuestro.
 *
 * Un estado desconocido **no se descarta**: se devuelve en minúsculas y la
 * comprobación de la base de datos decidirá. Perder un cambio de estado por no
 * conocer un nombre nuevo sería peor que fallar de forma visible.
 */
export function traducirEstado(estado: string): string {
  return estado.trim().toLowerCase();
}
