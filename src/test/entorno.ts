import { config } from "dotenv";

/**
 * Carga `.env.local` antes de cada archivo de tests.
 *
 * Los tests de aislamiento hablan con la base de datos real y necesitan
 * `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Next.js carga ese
 * archivo solo, pero vitest corre fuera de Next y no lo hace.
 *
 * Sin esto, `npm test` falla al arrancar el archivo de aislamiento y hay que
 * acordarse de lanzarlo con `node --env-file=.env.local`. Un gate que solo pasa
 * si te acuerdas de un comando concreto no es un gate.
 */
config({ path: ".env.local", quiet: true });
