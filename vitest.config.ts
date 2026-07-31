import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Los tests de aislamiento hablan con la base de datos real, así que van
    // en serie: si crearan workspaces a la vez se pisarían entre ellos.
    fileParallelism: false,
    testTimeout: 30_000,

    // Carga `.env.local` antes de cada archivo. Next.js lo hace solo, pero
    // vitest corre fuera de Next y sin esto los tests de aislamiento no
    // encuentran las claves de Supabase y ni siquiera arrancan.
    setupFiles: ["./src/test/entorno.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),

      // `server-only` existe para que la compilación falle si alguien importa
      // código de servidor desde el navegador. Es una protección que queremos,
      // pero los tests corren en Node fuera de Next.js y también los bloquea.
      // Aquí se sustituye por un módulo vacío: la protección sigue viva en la
      // aplicación, que es donde importa.
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
});
