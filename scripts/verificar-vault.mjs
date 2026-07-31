/**
 * Verificación de la migración de Vault.
 *
 * Comprueba dos cosas, y la segunda es la importante:
 *
 *   1. Que un secreto se guarda y se recupera igual (ida y vuelta).
 *   2. Que con la clave PÚBLICA **no se puede** ni guardar ni leer.
 *
 * En PostgreSQL una función recién creada la puede ejecutar PUBLIC por defecto,
 * y estas son SECURITY DEFINER. Si los REVOKE de la migración no se aplicaron,
 * cualquier usuario con sesión podría leer las claves de YCloud de todos los
 * clientes. Aquí es donde se ve.
 *
 * Uso:  node --env-file=.env.local scripts/verificar-vault.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secreta = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !secreta) {
  console.error("Faltan variables de Supabase en .env.local");
  process.exit(1);
}

const admin = createClient(url, secreta, { auth: { persistSession: false } });
const publico = createClient(url, anon, { auth: { persistSession: false } });

const NOMBRE = `prueba:vault:${Date.now()}`;
const VALOR = `valor-secreto-${Math.random().toString(36).slice(2)}`;

let fallos = 0;
const ok = (t) => console.log(`  ✅ ${t}`);
const mal = (t, d = "") => {
  console.log(`  ❌ ${t}${d ? `\n       ${d}` : ""}`);
  fallos++;
};

console.log("\n1. Con la clave SECRETA (debe funcionar)\n");

const { data: id, error: errorGuardar } = await admin.rpc("guardar_secreto", {
  p_nombre: NOMBRE,
  p_valor: VALOR,
});

if (errorGuardar || !id) {
  mal("guardar_secreto", errorGuardar?.message ?? "no devolvió identificador");
  console.log("\n   ¿Se aplicó la migración 20260731120000_vault.sql?\n");
  process.exit(1);
}
ok(`guardar_secreto devuelve un id (${String(id).slice(0, 8)}…)`);

const { data: recuperado, error: errorLeer } = await admin.rpc("leer_secreto", { p_id: id });
if (errorLeer) mal("leer_secreto", errorLeer.message);
else if (recuperado !== VALOR) mal("el valor recuperado no coincide con el guardado");
else ok("leer_secreto devuelve exactamente lo que se guardó");

// Idempotencia: el script de alta se puede ejecutar dos veces sin llenar el
// almacén de copias ni invalidar las referencias ya escritas en las tablas.
const { data: id2 } = await admin.rpc("guardar_secreto", {
  p_nombre: NOMBRE,
  p_valor: `${VALOR}-actualizado`,
});
if (id2 !== id) mal("guardar dos veces el mismo nombre creó un secreto nuevo");
else ok("guardar dos veces el mismo nombre reutiliza el id");

console.log("\n2. Con la clave PÚBLICA (debe estar prohibido)\n");

const { error: errorGuardarPublico } = await publico.rpc("guardar_secreto", {
  p_nombre: `${NOMBRE}:intruso`,
  p_valor: "no deberia entrar",
});
if (errorGuardarPublico) ok(`guardar_secreto denegado (${errorGuardarPublico.code ?? "error"})`);
else mal("¡la clave pública PUDO guardar un secreto! Revisa los REVOKE.");

const { data: leidoPublico, error: errorLeerPublico } = await publico.rpc("leer_secreto", {
  p_id: id,
});
if (errorLeerPublico) ok(`leer_secreto denegado (${errorLeerPublico.code ?? "error"})`);
else if (leidoPublico) mal("¡la clave pública LEYÓ un secreto en claro! Revisa los REVOKE.");
else mal("leer_secreto no falló con la clave pública, aunque no devolvió nada");

// Limpieza
await admin.rpc("guardar_secreto", { p_nombre: NOMBRE, p_valor: "borrado" });

console.log(
  fallos === 0
    ? "\n✅ Vault operativo y cerrado a la clave pública.\n"
    : `\n❌ ${fallos} comprobación(es) fallida(s).\n`,
);
process.exit(fallos === 0 ? 0 : 1);
