/**
 * Le dice al cron de Supabase a qué URL tiene que llamar.
 *
 * El barrido del buffer (`20260802220000_barrido.sql`) vive dentro de la base
 * de datos, pero la URL de producción no se puede saber hasta haber desplegado.
 * Este script cierra ese hueco.
 *
 * Los dos valores van a Vault y no a la definición del cron: `cron.job` es una
 * tabla que se puede leer, y ahí no pinta nada la clave que protege el endpoint
 * interno.
 *
 * Uso:
 *   node --env-file=.env.local scripts/configurar-barrido.mjs https://tu-app.vercel.app
 */
import { createClient } from "@supabase/supabase-js";

const [urlBase] = process.argv.slice(2);

if (!urlBase?.startsWith("https://")) {
  console.error("Uso: node --env-file=.env.local scripts/configurar-barrido.mjs <urlBase https>");
  process.exit(1);
}

const secreto = process.env.INTERNAL_API_SECRET;
if (!secreto) {
  console.error("Falta INTERNAL_API_SECRET en el entorno.");
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const url = `${urlBase.replace(/\/$/, "")}/api/internal/flush`;

for (const [nombre, valor] of [
  ["plataforma:flush:url", url],
  ["plataforma:flush:secreto", secreto],
]) {
  const { error } = await db.rpc("guardar_secreto", { p_nombre: nombre, p_valor: valor });
  if (error) {
    console.error(`No se pudo guardar ${nombre}:`, error.message);
    process.exit(1);
  }
  // Se confirma el nombre, nunca el valor.
  console.log(`Guardado en Vault: ${nombre}`);
}

console.log(`\nEl cron llamará cada minuto a:\n  ${url}`);

// Se dispara una vez a mano para no esperar al minuto y ver si responde.
const { error } = await db.rpc("barrer_buffer");
console.log(
  error
    ? `\nLa prueba falló: ${error.message}`
    : "\nBarrido lanzado a mano sin error. Comprueba en la app que llegó la petición.",
);
