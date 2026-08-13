"use server";

import { revalidatePath } from "next/cache";

import {
  buscarHerramienta,
  estaCompleta,
} from "@/lib/agent/herramientas/catalogo";
import { scoped } from "@/lib/data/scoped";
import { createClient } from "@/lib/supabase/server";

/**
 * Activar y configurar las capacidades del agente.
 *
 * Mismo patrón de las dos llaves: primero se comprueba el permiso con la sesión
 * de quien pide, y solo después se escribe con `scoped()`.
 */

export type EstadoCapacidad = { error?: string; ok?: boolean; aviso?: string };

async function puedeGestionar(negocioId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", negocioId)
    .maybeSingle()
    .overrideTypes<{ id: string; name: string }, { merge: false }>();

  if (!data) return false;

  const { error } = await supabase
    .from("workspaces")
    .update({ name: data.name })
    .eq("id", negocioId);

  return !error;
}

export async function guardarCapacidad(
  negocioId: string,
  clave: string,
  _previo: EstadoCapacidad,
  formData: FormData,
): Promise<EstadoCapacidad> {
  if (!(await puedeGestionar(negocioId))) {
    return { error: "No tienes permiso para cambiar este negocio." };
  }

  const herramienta = buscarHerramienta(clave);
  if (!herramienta) return { error: "Esa capacidad ya no existe." };

  const activa = formData.get("activa") === "si";

  const config: Record<string, string> = {};
  for (const campo of herramienta.config) {
    config[campo.clave] = String(formData.get(campo.clave) ?? "").trim();
  }

  /*
   * Activarla sin configurar no se permite, y no es rigidez: el modelo la
   * llamaría, recibiría un hueco, y le daría a la clienta un enlace inventado.
   * Es mejor que el agente diga «no lo sé» a que se lo invente.
   */
  if (activa && !estaCompleta(herramienta, config)) {
    const falta = herramienta.config.find((c) => !config[c.clave]);
    return {
      error: `Para activarla hace falta rellenar «${falta?.etiqueta}».`,
    };
  }

  // Un enlace mal escrito es tan malo como no tenerlo: se comprueba la forma.
  for (const campo of herramienta.config) {
    const valor = config[campo.clave];
    if (campo.tipo === "url" && valor) {
      try {
        const url = new URL(valor);
        if (url.protocol !== "https:" && url.protocol !== "http:")
          throw new Error();
      } catch {
        return {
          error: `«${campo.etiqueta}» tiene que ser una dirección web completa, empezando por https://`,
        };
      }
    }
  }

  const db = scoped(negocioId);

  const { error } = await db
    .from("workspace_tools")
    .upsert(
      { clave, activa, config, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id,clave" },
    );

  if (error) {
    console.error("[capacidades] no se pudo guardar", error.message);
    return { error: "No se pudo guardar. Inténtalo otra vez." };
  }

  await db.from("events").insert({
    type: activa ? "tool.enabled" : "tool.disabled",
    actor: "human",
    payload: { clave },
  });

  revalidatePath(`/app/negocios/${negocioId}/capacidades`);

  return {
    ok: true,
    aviso: activa
      ? "Activada. El agente ya puede usarla — pruébala en el chat de prueba."
      : "Desactivada. El agente deja de ofrecerla.",
  };
}
