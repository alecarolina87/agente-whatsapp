import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: lista, error: e1 } = await admin.auth.admin.listUsers();
if (e1) { console.error("error:", e1.message); process.exit(1); }

for (const u of lista.users) {
  const confirmado = Boolean(u.email_confirmed_at);
  console.log(`${u.email}  ->  ${confirmado ? "ya confirmada" : "SIN confirmar"}`);
  if (!confirmado) {
    const { error } = await admin.auth.admin.updateUserById(u.id, { email_confirm: true });
    console.log(error ? `   fallo: ${error.message}` : "   confirmada ahora");
  }
}
