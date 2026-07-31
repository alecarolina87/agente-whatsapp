import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";

import { comprobarLimites } from "./limites";

/**
 * Tests de los frenos de gasto.
 *
 * Hablan con la base de datos real, igual que los de aislamiento de F0. Aquí no
 * vale con probar funciones puras: lo que hay que comprobar es que **una
 * consulta cuenta lo que tiene que contar**, y eso solo se ve contra Postgres.
 *
 * Cada test deja el workspace como estaba, así que se pueden ejecutar en
 * cualquier orden.
 */

const admin = createAdminClient();

let workspaceId: string;
let conversacionId: string;
let otraConversacionId: string;

beforeAll(async () => {
  const sufijo = Date.now().toString(36);

  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: `Límites ${sufijo}`, slug: `limites-${sufijo}` })
    .select("id")
    .single();
  workspaceId = ws!.id;

  const { data: canal } = await admin
    .from("channels")
    .insert({ workspace_id: workspaceId, phone_number: `+9999${sufijo.slice(-7)}` })
    .select("id")
    .single();

  const crearConversacion = async (telefono: string) => {
    const { data: contacto } = await admin
      .from("contacts")
      .insert({ workspace_id: workspaceId, wa_phone: telefono })
      .select("id")
      .single();

    const { data: conv } = await admin
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        contact_id: contacto!.id,
        channel_id: canal!.id,
      })
      .select("id")
      .single();

    return conv!.id as string;
  };

  conversacionId = await crearConversacion(`+3460000${sufijo.slice(-4)}`);
  otraConversacionId = await crearConversacion(`+3461111${sufijo.slice(-4)}`);
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
});

/** Deja el workspace en un estado conocido antes de cada comprobación. */
async function configurar(cambios: Record<string, unknown>) {
  await admin
    .from("workspaces")
    .update({
      ia_activa: true,
      tope_mensual_usd: null,
      tope_respuestas_hora: 20,
      ...cambios,
    })
    .eq("id", workspaceId);
}

/** Inserta respuestas de IA con el coste indicado. */
async function insertarRespuestas(convId: string, cuantas: number, costeUsd: number | null) {
  const filas = Array.from({ length: cuantas }, () => ({
    workspace_id: workspaceId,
    conversation_id: convId,
    direction: "out" as const,
    type: "text" as const,
    sender: "ai" as const,
    status: "sent" as const,
    text: "respuesta de prueba",
    cost: costeUsd === null ? {} : { coste_usd: costeUsd },
  }));
  await admin.from("messages").insert(filas);
}

describe("comprobarLimites", () => {
  it("deja pasar cuando no hay ningún freno echado", async () => {
    await configurar({});
    await expect(comprobarLimites({ workspaceId, conversacionId })).resolves.toEqual({
      permitido: true,
    });
  });

  /*
   * El freno de mano es lo que se usa cuando algo va mal de verdad. Tiene que
   * cortar sin importar lo demás y sin desplegar nada.
   */
  it("el freno de mano corta aunque no se haya gastado nada", async () => {
    await configurar({ ia_activa: false });
    const veredicto = await comprobarLimites({ workspaceId, conversacionId });

    expect(veredicto.permitido).toBe(false);
    if (veredicto.permitido) return;
    expect(veredicto.motivo).toBe("freno_de_mano");
  });

  it("corta al alcanzar el tope de gasto del mes", async () => {
    await configurar({ tope_mensual_usd: 0.05 });
    await insertarRespuestas(conversacionId, 3, 0.02); // 0,06 > 0,05

    const veredicto = await comprobarLimites({ workspaceId, conversacionId });

    expect(veredicto.permitido).toBe(false);
    if (veredicto.permitido) return;
    expect(veredicto.motivo).toBe("tope_de_gasto");
    expect(Number(veredicto.detalle.gastado)).toBeCloseTo(0.06, 4);
  });

  it("no corta si el gasto se queda por debajo del tope", async () => {
    await configurar({ tope_mensual_usd: 10 });
    await expect(comprobarLimites({ workspaceId, conversacionId })).resolves.toEqual({
      permitido: true,
    });
  });

  /*
   * El test que atrapa el fallo que tuve escribiéndolo: contar las respuestas
   * de todo el workspace en vez de las de esa conversación. Así, un contacto
   * muy activo dejaría sin agente a todos los demás clientes.
   */
  it("el tope por contacto solo mira su propia conversación", async () => {
    await configurar({ tope_respuestas_hora: 5 });

    // Seis respuestas en OTRA conversación no deben frenar esta.
    await insertarRespuestas(otraConversacionId, 6, 0.001);

    await expect(comprobarLimites({ workspaceId, conversacionId })).resolves.toEqual({
      permitido: true,
    });

    // Pero en la suya, sí.
    const veredicto = await comprobarLimites({
      workspaceId,
      conversacionId: otraConversacionId,
    });

    expect(veredicto.permitido).toBe(false);
    if (veredicto.permitido) return;
    expect(veredicto.motivo).toBe("tope_por_contacto");
  });

  /* Sin tope configurado no se consulta el gasto y siempre se puede responder. */
  it("sin tope de gasto no frena por dinero", async () => {
    await configurar({ tope_mensual_usd: null });
    await insertarRespuestas(conversacionId, 5, 100);

    await expect(comprobarLimites({ workspaceId, conversacionId })).resolves.toEqual({
      permitido: true,
    });
  });
});
