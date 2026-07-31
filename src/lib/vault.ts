import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Acceso a los secretos guardados en Vault.
 *
 * Las tablas del esquema guardan **referencias**, no claves: `channels`
 * tiene `ycloud_credential_ref` y `webhook_secret_ref`, y lo que hay ahí es el
 * identificador de un secreto. Este módulo es lo único que traduce esa
 * referencia en el valor real.
 *
 * ## Por qué pasa por funciones de base de datos
 *
 * `vault.decrypted_secrets` descifra al leerse. Si la aplicación pudiera
 * consultarla, un `select` mal filtrado devolvería las claves de todos los
 * clientes en claro. Las funciones `guardar_secreto` y `leer_secreto` solo
 * permiten guardar uno y leer uno por su identificador, y únicamente las puede
 * ejecutar `service_role` (ver la migración `..._vault.sql`).
 *
 * ## Cuidado al usarlo
 *
 * Lo que devuelve `leerSecreto` es una credencial en claro. No debe acabar en
 * un log, ni en un mensaje de error, ni viajar al navegador. El `server-only`
 * de arriba hace que la compilación falle si alguien lo importa desde un
 * componente de cliente.
 */

/**
 * Guarda un secreto y devuelve su identificador, que es lo que se escribe en
 * las columnas `*_ref`.
 *
 * Es idempotente por nombre: llamarlo dos veces con el mismo nombre actualiza
 * el valor y devuelve el mismo identificador, así que las referencias que ya
 * existían siguen siendo válidas.
 */
export async function guardarSecreto(nombre: string, valor: string): Promise<string> {
  if (!nombre?.trim()) throw new Error("guardarSecreto requiere un nombre.");
  if (!valor?.trim()) throw new Error(`El secreto "${nombre}" no puede estar vacío.`);

  const db = createAdminClient();
  const { data, error } = await db.rpc("guardar_secreto", {
    p_nombre: nombre,
    p_valor: valor,
  });

  // El mensaje no lleva el valor: un error de base de datos acaba en los logs.
  if (error) throw new Error(`No se pudo guardar el secreto "${nombre}": ${error.message}`);
  if (!data) throw new Error(`Vault no devolvió identificador para "${nombre}".`);

  return data as string;
}

/**
 * Devuelve el valor de un secreto a partir de su referencia.
 *
 * Devuelve `null` cuando la referencia es nula o no existe, en vez de lanzar:
 * un canal a medio configurar es un estado legítimo, y quien llama decide qué
 * hacer con ello.
 */
export async function leerSecreto(referencia: string | null | undefined): Promise<string | null> {
  if (!referencia) return null;

  const db = createAdminClient();
  const { data, error } = await db.rpc("leer_secreto", { p_id: referencia });

  if (error) throw new Error(`No se pudo leer el secreto ${referencia}: ${error.message}`);

  return (data as string | null) ?? null;
}

/**
 * Nombre con el que se guarda cada secreto.
 *
 * Va aquí y no escrito a mano en cada sitio para que el script de alta y el
 * webhook no puedan discrepar: si uno guarda con un nombre y el otro busca con
 * otro, el fallo aparece en producción y no en un test.
 */
export const nombreSecreto = {
  ycloudApiKey: (workspaceId: string) => `ws:${workspaceId}:ycloud:api_key`,
  ycloudWebhook: (workspaceId: string) => `ws:${workspaceId}:ycloud:webhook_secret`,
} as const;
