/**
 * Sustituto vacío de `server-only` para el entorno de pruebas.
 *
 * En la aplicación, importar `server-only` hace que la compilación falle si un
 * módulo de servidor acaba en el navegador. Esa protección se mantiene intacta.
 *
 * Los tests, en cambio, corren en Node fuera de Next.js, donde ese paquete
 * lanza un error al importarse. Vitest lo redirige aquí (ver `vitest.config.ts`).
 */
export {};
