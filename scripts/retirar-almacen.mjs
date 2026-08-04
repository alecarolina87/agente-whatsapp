/**
 * Retira el almacén de archivos de WhatsApp.
 *
 * Va aparte de la migración porque Supabase prohíbe borrar de las tablas de
 * Storage por SQL y obliga a pasar por su API.
 *
 * El porqué de la decisión está en `20260804180000_sin_archivos.sql`. En corto:
 * por aquí pasan fotos de pacientes, y guardarlas convierte a la agencia en
 * encargada del tratamiento de datos de salud de gente que no sabe que existe.
 *
 * Uso:
 *   node --env-file=.env.local scripts/retirar-almacen.mjs
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "whatsapp-media";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: buckets } = await db.storage.listBuckets();

if (!buckets?.some((b) => b.name === BUCKET)) {
  console.log(`El bucket "${BUCKET}" ya no existe. Nada que hacer.`);
  process.exit(0);
}

/*
 * Vaciarlo primero: un bucket con contenido no se puede eliminar. Se recorre
 * workspace → conversación → archivos, que es como se guardaban.
 */
let borrados = 0;
const { data: carpetas } = await db.storage.from(BUCKET).list("");

for (const workspace of carpetas ?? []) {
  const { data: conversaciones } = await db.storage.from(BUCKET).list(workspace.name);

  for (const conversacion of conversaciones ?? []) {
    const ruta = `${workspace.name}/${conversacion.name}`;
    const { data: archivos } = await db.storage.from(BUCKET).list(ruta);

    if (archivos?.length) {
      await db.storage.from(BUCKET).remove(archivos.map((a) => `${ruta}/${a.name}`));
      borrados += archivos.length;
    }
  }
}

console.log(`Archivos borrados: ${borrados}`);

const { error } = await db.storage.deleteBucket(BUCKET);

if (error) {
  console.error("No se pudo eliminar el bucket:", error.message);
  process.exit(1);
}

console.log(`Bucket "${BUCKET}" eliminado. La plataforma ya no almacena archivos.`);
