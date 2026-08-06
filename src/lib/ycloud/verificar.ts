import "server-only";

import { normalizarE164 } from "./normalize";

/**
 * Comprueba unas credenciales de YCloud **antes** de guardarlas.
 *
 * ## Por qué existe
 *
 * Sin esto, una clave mal copiada se guarda tan tranquila y el fallo aparece
 * días después, cuando una clienta escribe y no le contesta nadie. Es el peor
 * momento posible para enterarse, porque además nada apunta a la causa: el
 * canal figura como conectado.
 *
 * ## Lo que comprueba de más, y es lo importante
 *
 * No solo si la clave sirve: también **si el número dado de alta está de verdad
 * en esa cuenta de YCloud**. Ese fallo ya pasó en este proyecto — se dio de alta
 * un canal con un número que no era el conectado a la API, y se descubrió por
 * casualidad. Aquí salta en el formulario.
 */

const BASE = "https://api.ycloud.com/v2";
const TIMEOUT_MS = 10_000;

export type NumeroDeLaCuenta = { telefono: string; nombre: string | null };

export type EstadoWebhook =
  | { ok: true; pegado: boolean; activo: boolean; urlesConfiguradas: string[] }
  | { ok: false; motivo: string };

/**
 * Comprueba si la URL de este negocio está pegada en su cuenta de YCloud.
 *
 * ## Por qué importa tanto
 *
 * Es el único paso del alta que ocurre **fuera** de esta plataforma, y su fallo
 * no da error en ninguna parte: el mensaje llega a YCloud y se queda ahí. El
 * negocio aparece configurado, la clienta ve su mensaje enviado, y nadie
 * contesta. Te enteras cuando el cliente llama.
 *
 * Se comprueba mirando los webhooks de su cuenta en vez de deducirlo de si
 * alguna vez llegó un mensaje, que era lo que se hacía antes: eso no distingue
 * «está bien puesto» de «está puesto pero todavía no ha escrito nadie».
 */
export async function comprobarWebhook({
  apiKey,
  urlEsperada,
}: {
  apiKey: string;
  urlEsperada: string;
}): Promise<EstadoWebhook> {
  if (!apiKey.trim()) return { ok: false, motivo: "Falta la API Key." };

  let respuesta: Response;

  try {
    respuesta = await fetch(`${BASE}/webhookEndpoints?limit=50`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const causa = error instanceof Error ? error.message : "desconocida";
    return { ok: false, motivo: `No se pudo conectar con YCloud (${causa}).` };
  }

  if (respuesta.status === 401 || respuesta.status === 403) {
    return { ok: false, motivo: "La API Key no es válida o no tiene permiso." };
  }

  if (!respuesta.ok) return { ok: false, motivo: `YCloud respondió ${respuesta.status}.` };

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    return { ok: false, motivo: "YCloud devolvió algo que no se pudo leer." };
  }

  const items = ((cuerpo as { items?: unknown[] })?.items ?? []) as {
    url?: string;
    status?: string;
  }[];

  // Se comparan sin la barra final: `…/abc` y `…/abc/` son el mismo sitio y
  // YCloud guarda lo que se pegara.
  const limpiar = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const buscada = limpiar(urlEsperada);

  const coincidencias = items.filter((e) => e.url && limpiar(e.url) === buscada);

  return {
    ok: true,
    pegado: coincidencias.length > 0,
    /*
     * Pegado y activo son cosas distintas. En este proyecto ya pasó: el webhook
     * estaba configurado y desactivado a mano, y desde fuera parecía correcto.
     */
    activo: coincidencias.some((e) => e.status === "active"),
    urlesConfiguradas: items.flatMap((e) => (e.url ? [e.url] : [])),
  };
}

export type ResultadoVerificacion =
  | {
      ok: true;
      numeros: NumeroDeLaCuenta[];
      /** `null` si no se pidió comprobar ninguno. */
      coincide: boolean | null;
    }
  | { ok: false; motivo: string };

/**
 * @param telefono  Opcional. Si se pasa, se comprueba que esté en la cuenta.
 */
export async function comprobarCredenciales({
  apiKey,
  telefono,
}: {
  apiKey: string;
  telefono?: string;
}): Promise<ResultadoVerificacion> {
  if (!apiKey.trim()) return { ok: false, motivo: "Falta la API Key." };

  let respuesta: Response;

  try {
    /*
     * Se listan los números de la cuenta porque es la llamada más barata que
     * sirve para dos cosas a la vez: si responde, la clave es válida; y lo que
     * devuelve permite comprobar el número. Enviar un mensaje de prueba también
     * validaría la clave, pero costaría dinero y molestaría a alguien.
     */
    respuesta = await fetch(`${BASE}/whatsapp/phoneNumbers?limit=50`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const causa = error instanceof Error ? error.message : "desconocida";
    return { ok: false, motivo: `No se pudo conectar con YCloud (${causa}).` };
  }

  if (respuesta.status === 401 || respuesta.status === 403) {
    return { ok: false, motivo: "La API Key no es válida o no tiene permiso." };
  }

  if (!respuesta.ok) {
    return { ok: false, motivo: `YCloud respondió ${respuesta.status}.` };
  }

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    return { ok: false, motivo: "YCloud devolvió algo que no se pudo leer." };
  }

  const items = (cuerpo as { items?: unknown[] })?.items ?? [];

  const numeros: NumeroDeLaCuenta[] = items.flatMap((n) => {
    const fila = n as { phoneNumber?: string; verifiedName?: string };
    const normalizado = fila.phoneNumber ? normalizarE164(fila.phoneNumber) : null;
    return normalizado ? [{ telefono: normalizado, nombre: fila.verifiedName ?? null }] : [];
  });

  if (numeros.length === 0) {
    return {
      ok: false,
      motivo: "La clave funciona, pero esa cuenta de YCloud no tiene ningún número conectado.",
    };
  }

  // Se compara en E.164 por los dos lados: YCloud a veces devuelve el número
  // sin el `+` y compararlo tal cual daría un falso negativo.
  const buscado = telefono ? normalizarE164(telefono) : null;

  return {
    ok: true,
    numeros,
    coincide: buscado ? numeros.some((n) => n.telefono === buscado) : null,
  };
}
