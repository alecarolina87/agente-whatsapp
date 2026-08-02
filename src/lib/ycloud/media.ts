import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import type { AdjuntoEntrante } from "./types";

/**
 * Descarga el archivo de un mensaje entrante y lo guarda en Supabase Storage.
 *
 * Existe por una razón concreta: **los enlaces de YCloud caducan**. Si el
 * archivo no se baja mientras se procesa el webhook, la foto que mandó la
 * clienta ya no se puede recuperar y en la bandeja queda un mensaje vacío.
 */

/** El bucket privado que crea `20260802100000_media.sql`. */
export const BUCKET = "whatsapp-media";

/**
 * El único host del que se acepta descargar.
 *
 * Sin esta comprobación el webhook sería un SSRF de manual: el enlace viene
 * dentro del cuerpo de la petición, así que quien lograra colar un evento
 * podría hacer que **nuestro servidor** —con su red y sus credenciales— pidiera
 * lo que quisiera y guardara el resultado. Se compara el host exacto, no un
 * `startsWith`: `api.ycloud.com.atacante.net` empieza igual.
 */
const HOST_PERMITIDO = "api.ycloud.com";

/** Cuánto se espera por la descarga antes de rendirse. */
const TIMEOUT_MS = 15_000;

/**
 * Tope duro por si el `Content-Length` miente o no viene. El bucket ya rechaza
 * lo que pase de 25 MB, pero para entonces el archivo ya estaría en memoria.
 */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * De tipo MIME a extensión.
 *
 * Hace falta porque el nombre del archivo no siempre llega —las fotos de
 * WhatsApp no tienen nombre— y sin extensión el navegador no sabe si lo que
 * hay al otro lado de la URL firmada es una imagen o algo que descargar.
 */
const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

/**
 * Lo que se guarda en `messages.media`.
 *
 * Se conserva el `mime` y el nombre original además de la ruta porque la
 * bandeja los necesita para decidir cómo pintar el mensaje sin volver a pedir
 * nada al almacén.
 */
export type MediaGuardada = {
  /** Ruta dentro del bucket. Nunca una URL: las firmadas caducan. */
  ruta: string;
  mime: string;
  /** Nombre para enseñar y para la descarga. */
  nombre: string;
  bytes: number;
  /** Identificador del archivo en YCloud, por si hay que reclamar algo. */
  ycloudId: string | null;
};

/** Un fallo de descarga no puede tumbar el webhook: se devuelve, no se lanza. */
export type ResultadoMedia =
  | { ok: true; media: MediaGuardada }
  | { ok: false; motivo: string };

/** Quita todo lo que pueda torcer una ruta de objeto o un nombre de descarga. */
function nombreSeguro(nombre: string): string {
  return (
    nombre
      .normalize("NFKD")
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/^[.\-]+/, "") // nada de rutas relativas ni archivos ocultos
      .slice(0, 80) || "archivo"
  );
}

function extensionDe(mime: string, nombre: string | null): string {
  const delNombre = nombre?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  // El MIME manda sobre el nombre: el nombre lo escribe quien envía.
  return EXTENSIONES[mime.split(";")[0].trim().toLowerCase()] ?? delNombre?.toLowerCase() ?? "bin";
}

/**
 * Comprueba que el enlace es de YCloud y por HTTPS.
 *
 * Separada para poder probarla sin red: es la pieza de seguridad del módulo.
 */
export function enlaceDeConfianza(enlace: string): boolean {
  let url: URL;
  try {
    url = new URL(enlace);
  } catch {
    return false;
  }

  return url.protocol === "https:" && url.hostname.toLowerCase() === HOST_PERMITIDO;
}

/**
 * Baja el archivo de YCloud y lo sube al bucket.
 *
 * @param apiKey  La del canal, sacada de Vault. YCloud pide `X-API-Key`
 *                también para descargar: los enlaces no son públicos.
 */
export async function guardarAdjunto({
  adjunto,
  apiKey,
  workspaceId,
  conversacionId,
}: {
  adjunto: AdjuntoEntrante;
  apiKey: string;
  workspaceId: string;
  conversacionId: string;
}): Promise<ResultadoMedia> {
  if (!adjunto.enlace) {
    return { ok: false, motivo: "el adjunto llegó sin enlace de descarga" };
  }

  if (!enlaceDeConfianza(adjunto.enlace)) {
    // Se registra el host, no el enlace entero: puede llevar credenciales.
    let host = "ilegible";
    try {
      host = new URL(adjunto.enlace).hostname;
    } catch {
      /* se queda en "ilegible" */
    }
    return { ok: false, motivo: `enlace de un host no permitido: ${host}` };
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(adjunto.enlace, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Un redirect podría llevar fuera de YCloud después de haber validado el
      // host, que es justo lo que la comprobación intenta evitar.
      redirect: "error",
    });
  } catch (error) {
    const causa = error instanceof Error ? error.message : "desconocida";
    return { ok: false, motivo: `no se pudo descargar el archivo: ${causa}` };
  }

  if (!respuesta.ok) {
    return { ok: false, motivo: `YCloud devolvió ${respuesta.status} al descargar` };
  }

  const declarado = Number(respuesta.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_BYTES) {
    return { ok: false, motivo: `archivo demasiado grande: ${declarado} bytes` };
  }

  const datos = new Uint8Array(await respuesta.arrayBuffer());
  if (datos.byteLength > MAX_BYTES) {
    return { ok: false, motivo: `archivo demasiado grande: ${datos.byteLength} bytes` };
  }
  if (datos.byteLength === 0) {
    return { ok: false, motivo: "el archivo llegó vacío" };
  }

  /*
   * El MIME que declara el evento se cree por delante del de la respuesta:
   * YCloud a veces sirve `application/octet-stream` y con eso el navegador no
   * enseñaría la foto en la bandeja.
   */
  const mime =
    adjunto.mime ?? respuesta.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream";

  const extension = extensionDe(mime, adjunto.nombre);
  const base = adjunto.nombre ? nombreSeguro(adjunto.nombre.replace(/\.[^.]+$/, "")) : "adjunto";
  const nombre = `${base}.${extension}`;

  /*
   * La ruta empieza por el workspace y sigue por la conversación: así una
   * política de Storage o un borrado por cliente son un prefijo, no una
   * consulta. El sello de tiempo evita que dos fotos con el mismo nombre se
   * pisen.
   */
  const ruta = `${workspaceId}/${conversacionId}/${Date.now()}-${nombre}`;

  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, datos, {
    contentType: mime,
    upsert: false, // si la ruta ya existe es un reintento; no se sobrescribe
  });

  if (error) {
    return { ok: false, motivo: `no se pudo guardar el archivo: ${error.message}` };
  }

  return {
    ok: true,
    media: {
      ruta,
      mime,
      nombre,
      bytes: datos.byteLength,
      ycloudId: adjunto.id,
    },
  };
}

/**
 * URL temporal para enseñar el archivo en la bandeja.
 *
 * El bucket es privado, así que esta es la única forma de verlo. Caduca en una
 * hora: suficiente para mirar un hilo, poco para que una URL copiada por error
 * en un chat siga sirviendo mañana.
 */
export async function urlFirmada(ruta: string, segundos = 3600): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, segundos);

  return error ? null : data.signedUrl;
}
