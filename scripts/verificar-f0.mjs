/**
 * Verificación del gate de F0.
 *
 * Comprueba dos cosas distintas y complementarias:
 *   1. Con la clave SECRETA (se salta RLS): que las 9 tablas existen.
 *   2. Con la clave PÚBLICA y sin sesión: que RLS deniega. Si aquí saliera
 *      cualquier fila, el aislamiento estaría roto.
 *
 * Uso:  node --env-file=.env.local scripts/verificar-f0.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secreta = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !secreta) {
  console.error("Faltan variables en .env.local");
  process.exit(1);
}

const TABLAS = [
  "workspaces",
  "workspace_members",
  "channels",
  "integrations",
  "contacts",
  "conversations",
  "messages",
  "processed_events",
  "events",
];

const servidor = createClient(url, secreta, { auth: { persistSession: false } });
const cliente = createClient(url, anon, { auth: { persistSession: false } });

let fallos = 0;

console.log("\n1) ¿Existen las tablas?  (clave secreta, se salta RLS)\n");
for (const t of TABLAS) {
  const { error } = await servidor.from(t).select("id").limit(1);
  if (error) {
    console.log(`   ✗ ${t.padEnd(20)} ${error.message}`);
    fallos++;
  } else {
    console.log(`   ✓ ${t}`);
  }
}

console.log("\n2) ¿RLS deniega a quien no ha iniciado sesión?  (clave pública)\n");
for (const t of TABLAS) {
  const { data, error } = await cliente.from(t).select("id").limit(1);
  if (error) {
    // Denegar con error también es correcto: la tabla no se expone.
    console.log(`   ✓ ${t.padEnd(20)} denegado (${error.code ?? "error"})`);
  } else if (data.length === 0) {
    console.log(`   ✓ ${t.padEnd(20)} 0 filas`);
  } else {
    console.log(`   ✗ ${t.padEnd(20)} ¡DEVUELVE DATOS SIN SESIÓN!`);
    fallos++;
  }
}

console.log(
  fallos === 0
    ? "\n✅ Gate de F0 (esquema + RLS): correcto\n"
    : `\n❌ ${fallos} problema(s)\n`,
);
process.exit(fallos === 0 ? 0 : 1);
