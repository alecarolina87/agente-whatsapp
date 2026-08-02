/**
 * Comprueba que el almacén de archivos está bien montado.
 *
 * Es la mitad de la cadena que se puede verificar sin WhatsApp: la otra mitad
 * —descargar de YCloud— necesita una foto de verdad y un número activo.
 *
 * Prueba cuatro cosas, en este orden:
 *   1. El bucket existe y es **privado**.
 *   2. Se puede subir un archivo.
 *   3. La URL firmada sirve el archivo.
 *   4. Sin firma, la URL pública **no** sirve nada.
 *
 * La cuarta es la importante. Ahí dentro van fotos de la piel de clientas: un
 * bucket público sería una galería de datos de salud a la que se llega
 * adivinando una URL.
 *
 * Uso:
 *   node --env-file=.env.local scripts/verificar-media.mjs
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "whatsapp-media";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let fallos = 0;
const comprobar = (bien, titulo, detalle = "") => {
  if (!bien) fallos += 1;
  console.log(`${bien ? "✅" : "❌"} ${titulo}${detalle ? `  — ${detalle}` : ""}`);
};

// 1 · El bucket
const { data: buckets, error: errorLista } = await db.storage.listBuckets();
if (errorLista) {
  console.error("No se pudo listar los buckets:", errorLista.message);
  process.exit(1);
}

const bucket = buckets.find((b) => b.name === BUCKET);
comprobar(Boolean(bucket), `El bucket "${BUCKET}" existe`);
if (!bucket) {
  console.error("\nFalta aplicar la migración 20260802100000_media.sql.");
  process.exit(1);
}

comprobar(bucket.public === false, "Es privado", bucket.public ? "¡ES PÚBLICO!" : "");

// 2 · Subir
const ruta = `_prueba/${Date.now()}-prueba.txt`;
const contenido = new TextEncoder().encode("prueba de almacenamiento");

const { error: errorSubida } = await db.storage
  .from(BUCKET)
  .upload(ruta, contenido, { contentType: "text/plain" });

comprobar(!errorSubida, "Se puede subir un archivo", errorSubida?.message ?? "");

if (!errorSubida) {
  // 3 · URL firmada
  const { data: firmada } = await db.storage.from(BUCKET).createSignedUrl(ruta, 60);
  const conFirma = firmada?.signedUrl ? await fetch(firmada.signedUrl) : null;
  comprobar(conFirma?.ok === true, "La URL firmada sirve el archivo", `HTTP ${conFirma?.status}`);

  // 4 · Sin firma, nada
  const publica = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${ruta}`;
  const sinFirma = await fetch(publica);
  comprobar(
    sinFirma.status === 400 || sinFirma.status === 404,
    "Sin firma no se llega al archivo",
    `HTTP ${sinFirma.status}`,
  );

  await db.storage.from(BUCKET).remove([ruta]);
}

console.log(fallos === 0 ? "\nTodo en orden." : `\n${fallos} comprobación(es) fallida(s).`);
process.exit(fallos === 0 ? 0 : 1);
