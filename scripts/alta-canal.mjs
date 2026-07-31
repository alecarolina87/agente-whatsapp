/**
 * Alta de un cliente: workspace, canal de WhatsApp y credenciales en Vault.
 *
 * En F4 esto será un asistente dentro de la aplicación. Hoy es un script, y
 * hace exactamente lo mismo que hará la app: las claves **no se escriben en
 * ningún archivo del proyecto**, se leen del entorno y se guardan cifradas en
 * Vault. En las tablas solo queda la referencia.
 *
 * Uso:
 *   node --env-file=.env.local scripts/alta-canal.mjs
 *
 * Necesita en .env.local, además de las de Supabase:
 *   YCLOUD_API_KEY          clave de la cuenta de YCloud del cliente
 *   YCLOUD_WEBHOOK_SECRET   secreto del webhook de esa misma cuenta
 *   YCLOUD_PHONE_NUMBER     el número, en E.164:  +34600111222
 *   WORKSPACE_NOMBRE        opcional, por defecto "Pruebas"
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secreta = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.YCLOUD_API_KEY;
const webhookSecret = process.env.YCLOUD_WEBHOOK_SECRET;
const telefono = process.env.YCLOUD_PHONE_NUMBER;
const nombreWorkspace = process.env.WORKSPACE_NOMBRE ?? "Pruebas";

const faltan = Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: secreta,
  YCLOUD_API_KEY: apiKey,
  YCLOUD_WEBHOOK_SECRET: webhookSecret,
  YCLOUD_PHONE_NUMBER: telefono,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (faltan.length) {
  console.error(`Faltan variables en .env.local:\n  ${faltan.join("\n  ")}`);
  process.exit(1);
}

if (!/^\+[1-9]\d{7,14}$/.test(telefono)) {
  console.error(`YCLOUD_PHONE_NUMBER debe ir en E.164 (con +). Recibido: ${telefono}`);
  process.exit(1);
}

const db = createClient(url, secreta, { auth: { persistSession: false } });

/** Igual que `nombreSecreto` en src/lib/vault.ts. Si cambia uno, cambia el otro. */
const nombreSecreto = {
  apiKey: (ws) => `ws:${ws}:ycloud:api_key`,
  webhook: (ws) => `ws:${ws}:ycloud:webhook_secret`,
};

const slug = nombreWorkspace
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

// ── Workspace ────────────────────────────────────────────────────────────────
let workspaceId;
{
  const { data: existente } = await db
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existente) {
    workspaceId = existente.id;
    console.log(`Workspace "${nombreWorkspace}" ya existía.`);
  } else {
    const { data, error } = await db
      .from("workspaces")
      .insert({ name: nombreWorkspace, slug })
      .select("id")
      .single();

    if (error) {
      console.error("No se pudo crear el workspace:", error.message);
      process.exit(1);
    }
    workspaceId = data.id;
    console.log(`Workspace "${nombreWorkspace}" creado.`);
  }
}

// ── Secretos en Vault ────────────────────────────────────────────────────────
async function guardar(nombre, valor) {
  const { data, error } = await db.rpc("guardar_secreto", {
    p_nombre: nombre,
    p_valor: valor,
  });
  if (error) {
    // Sin el valor dentro: este mensaje puede acabar en un log.
    console.error(`No se pudo guardar el secreto "${nombre}": ${error.message}`);
    console.error("¿Has aplicado la migración 20260731120000_vault.sql?");
    process.exit(1);
  }
  return data;
}

const refApiKey = await guardar(nombreSecreto.apiKey(workspaceId), apiKey);
const refWebhook = await guardar(nombreSecreto.webhook(workspaceId), webhookSecret);
console.log("Credenciales guardadas en Vault.");

// ── Canal ────────────────────────────────────────────────────────────────────
// `phone_number` es único a nivel global, así que el upsert por ese campo
// también sirve para reasignar un número que ya estuviera dado de alta.
const { data: canal, error: errorCanal } = await db
  .from("channels")
  .upsert(
    {
      workspace_id: workspaceId,
      phone_number: telefono,
      display_name: nombreWorkspace,
      ycloud_credential_ref: refApiKey,
      webhook_secret_ref: refWebhook,
      system_prompt:
        "Eres el asistente de atención al cliente de este negocio. Ayudas a resolver dudas y a concertar citas. Eres directo, cercano y breve.",
      ai_default_enabled: true,
      status: "active",
    },
    { onConflict: "phone_number" },
  )
  .select("id")
  .single();

if (errorCanal) {
  console.error("No se pudo crear el canal:", errorCanal.message);
  process.exit(1);
}

// ── Aviso ────────────────────────────────────────────────────────────────────
// El webhook elige el secreto del único canal activo del workspace. Con dos, no
// hay forma de saber cuál usar sin leer el cuerpo, y del cuerpo no se puede uno
// fiar antes de verificar la firma. Mejor avisar aquí que fallar en producción.
const { count: activos } = await db
  .from("channels")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", workspaceId)
  .eq("status", "active");

if ((activos ?? 0) > 1) {
  console.warn(
    `\n⚠  Este workspace tiene ${activos} canales activos. El webhook no puede\n` +
      "   elegir con qué secreto verificar la firma y devolverá 409.\n" +
      "   Deja solo uno activo.",
  );
}

console.log(`Canal ${telefono} listo.\n`);
console.log("─".repeat(68));
console.log("Pega esta URL en el webhook de YCloud (cambiando el dominio por el");
console.log("que te dé el túnel):\n");
console.log(`   https://TU-TUNEL.trycloudflare.com/api/webhooks/ycloud/${workspaceId}`);
console.log("\n─".repeat(1) + "─".repeat(67));
console.log(`\nworkspace_id = ${workspaceId}`);
console.log(`channel_id   = ${canal.id}`);
