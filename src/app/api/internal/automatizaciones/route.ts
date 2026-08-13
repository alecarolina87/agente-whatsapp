import { timingSafeEqual } from "node:crypto";

import { barrerTodo } from "@/lib/automatizaciones/motor";

/**
 * Pasa por las automatizaciones de tiempo de todos los negocios.
 *
 * Lo llama `barrer_automatizaciones()` desde pg_cron cada diez minutos. También
 * se puede llamar a mano, que es como se prueba sin esperar al cron.
 *
 * ## Por qué un endpoint y no todo dentro de Postgres
 *
 * Igual que el barrido del buffer: la acción acaba en una llamada a WhatsApp, y
 * eso no lo hace la base de datos. El cron avisa, la aplicación trabaja.
 *
 * ## Protección
 *
 * El mismo secreto compartido que el vaciado de lotes. Sin él, cualquiera
 * podría forzar el barrido de todos los clientes — y aquí eso no es solo gasto:
 * son mensajes que salen a clientas reales.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretoValido(recibido: string | null, esperado: string) {
  if (!recibido) return false;

  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export async function POST(peticion: Request) {
  const esperado = process.env.INTERNAL_API_SECRET;

  if (!esperado) {
    console.error("[automatizaciones] falta INTERNAL_API_SECRET");
    return new Response("no disponible", { status: 503 });
  }

  if (!secretoValido(peticion.headers.get("x-internal-secret"), esperado)) {
    return new Response("no autorizado", { status: 401 });
  }

  const comenzado = Date.now();

  try {
    const resumen = await barrerTodo();
    return Response.json({ ...resumen, ms: Date.now() - comenzado });
  } catch (causa) {
    /*
     * Se responde 200 con el fallo dentro a propósito. `net.http_post` no mira
     * la respuesta, así que un 500 no cambia nada salvo llenar los logs de
     * Supabase de errores rojos cada diez minutos por algo que ya está escrito
     * aquí con su motivo.
     */
    const motivo = causa instanceof Error ? causa.message : String(causa);
    console.error("[automatizaciones] barrido fallido", motivo);
    return Response.json({ error: motivo, ms: Date.now() - comenzado });
  }
}
