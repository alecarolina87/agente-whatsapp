/**
 * Pone al día el historial de migraciones sin volver a aplicarlas.
 *
 * ## Por qué hace falta esto
 *
 * Las diez primeras migraciones de este proyecto se aplicaron **a mano**,
 * pegándolas en el editor SQL de Supabase. Funcionan y están en la base de
 * datos, pero Supabase no tiene constancia: su tabla de historial está vacía.
 *
 * Si se lanzara `supabase db push` así, intentaría aplicarlas todas otra vez y
 * fallaría a la primera —`type ya existe`, `table ya existe`— dejando además la
 * duda de si algo se ejecutó a medias.
 *
 * Lo que hace este script es **anotarlas como aplicadas** sin ejecutar su SQL.
 * A partir de ahí, `npm run db:subir` solo manda las nuevas, que es como debió
 * ser desde el principio.
 *
 * Se corre **una sola vez**. Después ya no hace falta.
 *
 * Antes hay que haber hecho:
 *   npm run sb -- login
 *   npm run sb -- link --project-ref <el tuyo>
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * En Windows el CLI es un `.cmd`, y Node ya no ejecuta esos archivos
 * directamente. Se lanza a través de `cmd /c` en vez de con `shell: true`
 * porque esa opción concatena los argumentos sin escaparlos —Node avisa de
 * ello— y aquí no hace ninguna falta.
 */
const esWindows = process.platform === "win32";
const CLI = join("node_modules", ".bin", esWindows ? "supabase.cmd" : "supabase");

const lanzar = (args) =>
  esWindows
    ? { mando: "cmd", argumentos: ["/c", CLI, ...args] }
    : { mando: CLI, argumentos: args };

const versiones = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.split("_")[0])
  .sort();

if (versiones.length === 0) {
  console.error("No hay migraciones en supabase/migrations.");
  process.exit(1);
}

console.log(`Marcando ${versiones.length} migraciones como ya aplicadas:\n`);
for (const v of versiones) console.log("  ", v);

/*
 * De una en una y no todas de golpe a propósito: `repair` es idempotente para
 * cada versión, así que si falla la quinta se vuelve a lanzar el script entero
 * sin consecuencias. Y así se ve cuál falló, que con una sola llamada no se
 * distingue.
 */
let fallos = 0;

for (const version of versiones) {
  const { mando, argumentos } = lanzar(["migration", "repair", "--status", "applied", version]);

  try {
    execFileSync(mando, argumentos, { stdio: ["ignore", "ignore", "pipe"] });
    console.log("  ✅", version);
  } catch (error) {
    fallos += 1;
    console.log("  ❌", version, "—", String(error.stderr ?? "").trim().split("\n").pop());
  }
}

if (fallos > 0) {
  console.error(
    `\n${fallos} fallaron. Comprueba que hiciste \`npm run sb -- login\` y ` +
      "`npm run sb -- link --project-ref TU-REF`. Se puede relanzar sin problema.",
  );
  process.exit(1);
}

console.log("\nListo. Comprueba con:  npm run db:estado");
console.log("A partir de ahora, una migración nueva se aplica con:  npm run db:subir");
