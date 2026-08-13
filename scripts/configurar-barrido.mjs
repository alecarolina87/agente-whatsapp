/**
 * Le dice al cron de Supabase a qué URL tiene que llamar.
 *
 * Son dos crons: el del buffer (cada minuto, para contestar) y el de las
 * automatizaciones (cada diez, para los recordatorios). Los dos viven dentro de
 * la base
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

const base = urlBase.replace(/\/$/, "");
const url = `${base}/api/internal/flush`;
const urlAutomatizaciones = `${base}/api/internal/automatizaciones`;

/*
 * El secreto es uno solo para los dos endpoints internos. No es pereza: son la
 * misma superficie —trabajo de fondo de la plataforma, disparado por su propio
 * cron— y dos secretos que rotar en vez de uno serían dos oportunidades de
 * dejarse uno a medias.
 */
for (const [nombre, valor] of [
  ["plataforma:flush:url", url],
  ["plataforma:automatizaciones:url", urlAutomatizaciones],
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

console.log(`\nCada minuto:      ${url}`);
console.log(`Cada 10 minutos:  ${urlAutomatizaciones}`);

/*
 * Se prueban los endpoints, no las funciones de la base.
 *
 * Antes esto llamaba a `barrer_buffer()` por RPC y siempre respondía
 * «permission denied» — porque la migración le quita el permiso a todo el
 * mundo a propósito, y el service-role hereda de PUBLIC. El cron sí puede
 * (corre como el dueño de la función), así que aquel fallo no significaba nada:
 * era una prueba que no se podía pasar, avisando de una avería que no existía.
 *
 * Llamar al endpoint con el secreto hace exactamente lo que hará el cron dentro
 * de un minuto, y si algo está mal se ve aquí.
 */
console.log("");

for (const [nombre, destino] of [
  ["buffer", url],
  ["automatizaciones", urlAutomatizaciones],
]) {
  try {
    const respuesta = await fetch(destino, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secreto },
      body: "{}",
    });

    const cuerpo = await respuesta.text();
    console.log(`${nombre}: ${respuesta.status} — ${cuerpo.slice(0, 200)}`);
  } catch (causa) {
    console.log(`${nombre}: no respondió — ${causa.message}`);
  }
}
