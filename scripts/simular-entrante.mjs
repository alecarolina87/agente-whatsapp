/**
 * Simula un mensaje entrante de YCloud, firmado de verdad.
 *
 * Sirve para probar la cadena completa —firma, deduplicación, guardado, ACK y
 * respuesta del agente— sin depender de que llegue un WhatsApp real. Es la
 * forma de separar "mi código falla" de "el mensaje no llega".
 *
 * La firma se calcula con el mismo secreto que hay en Vault, así que el webhook
 * la acepta igual que si viniera de YCloud. No es un atajo de seguridad: quien
 * ejecuta esto ya tiene la clave de servicio de la base de datos.
 *
 * Uso:
 *   node --env-file=.env.local scripts/simular-entrante.mjs <urlBase> <workspaceId> <deQuien> ["texto"]
 */
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [urlBase, workspaceId, deQuien, texto = "Hola, ¿tenéis cita esta semana?"] =
  process.argv.slice(2);

if (!urlBase || !workspaceId || !deQuien) {
  console.error(
    "Uso: node --env-file=.env.local scripts/simular-entrante.mjs <urlBase> <workspaceId> <deQuien> [texto]",
  );
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// El secreto sale de Vault, igual que lo lee el webhook.
const { data: canal } = await db
  .from("channels")
  .select("phone_number, webhook_secret_ref")
  .eq("workspace_id", workspaceId)
  .eq("status", "active")
  .single();

if (!canal) {
  console.error("No hay canal activo en ese workspace.");
  process.exit(1);
}

const { data: secreto } = await db.rpc("leer_secreto", { p_id: canal.webhook_secret_ref });
if (!secreto) {
  console.error("El canal no tiene secreto de webhook en Vault.");
  process.exit(1);
}

const cuerpo = JSON.stringify({
  id: `evt_sim_${randomUUID()}`,
  type: "whatsapp.inbound_message.received",
  createTime: new Date().toISOString(),
  whatsappInboundMessage: {
    wamid: `wamid.SIM.${randomUUID()}`,
    from: deQuien.replace(/^\+/, ""), // YCloud manda el número sin el +
    to: canal.phone_number.replace(/^\+/, ""),
    type: "text",
    text: { body: texto },
    customerProfile: { name: "Prueba" },
  },
});

const t = Math.floor(Date.now() / 1000);
const firma = createHmac("sha256", secreto).update(`${t}.${cuerpo}`).digest("hex");

const url = `${urlBase.replace(/\/$/, "")}/api/webhooks/ycloud/${workspaceId}`;
console.log(`POST  ${url}`);
console.log(`      de ${deQuien} para ${canal.phone_number}: "${texto}"\n`);

const comenzado = Date.now();
const r = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "YCloud-Signature": `t=${t},s=${firma}` },
  body: cuerpo,
});

const ms = Date.now() - comenzado;
console.log(`HTTP ${r.status} en ${ms} ms  ${ms < 2000 ? "✅ (por debajo de los 2 s)" : "⚠️  (por encima de los 2 s)"}`);
console.log(await r.text());
