/**
 * Tests de aislamiento entre workspaces.
 *
 * Es el gate de salida de F0 que fija el §13 del BLUEPRINT:
 * "tests de aislamiento en verde".
 *
 * Lo que se comprueba aquí no es que el código funcione, sino que **no se pueda
 * romper**: que un workspace no vea, no modifique y no borre los datos de otro,
 * ni siquiera desde el servidor, que usa la clave que se salta RLS.
 *
 * Hablan con la base de datos real. Crean dos workspaces con datos, comprueban
 * el aislamiento y limpian al terminar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scoped } from "./scoped";
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();

/**
 * Sin tipos generados de la base de datos, el cliente devuelve las columnas
 * como `unknown`. Este ayudante fija la forma esperada en los tests, que es lo
 * único que necesitan. Cuando se generen los tipos con la CLI de Supabase, esto
 * desaparece.
 */
type Contacto = { name: string | null };

const nombresDe = (filas: unknown): (string | null)[] =>
  (filas as Contacto[] | null)?.map((c) => c.name) ?? [];

let wsA: string;
let wsB: string;

const marca = `test-${Date.now()}`;

beforeAll(async () => {
  const { data, error } = await admin
    .from("workspaces")
    .insert([
      { name: "Clínica de prueba A", slug: `${marca}-a` },
      { name: "Peluquería de prueba B", slug: `${marca}-b` },
    ])
    .select("id, slug");

  if (error) throw new Error(`No se pudieron crear los workspaces: ${error.message}`);

  wsA = data.find((w) => w.slug.endsWith("-a"))!.id;
  wsB = data.find((w) => w.slug.endsWith("-b"))!.id;

  // Un contacto en cada workspace, con el MISMO teléfono a propósito: así se
  // comprueba de paso que el unique de dedupe es por workspace y no global.
  await scoped(wsA).from("contacts").insert({ wa_phone: "+34600000001", name: "Ana de A" });
  await scoped(wsB).from("contacts").insert({ wa_phone: "+34600000001", name: "Bea de B" });
});

afterAll(async () => {
  // El on delete cascade se lleva contactos, conversaciones y mensajes.
  await admin.from("workspaces").delete().in("id", [wsA, wsB]);
});

describe("capa de datos con scope", () => {
  it("cada workspace solo ve sus propios contactos", async () => {
    const { data: deA } = await scoped(wsA).from("contacts").select("name");
    const { data: deB } = await scoped(wsB).from("contacts").select("name");

    expect(nombresDe(deA)).toEqual(["Ana de A"]);
    expect(nombresDe(deB)).toEqual(["Bea de B"]);
  });

  it("el mismo teléfono puede existir en dos workspaces distintos", async () => {
    // El unique es (workspace_id, wa_phone), no wa_phone a secas: dos clientes
    // pueden tener el mismo cliente final sin pisarse.
    const { data } = await admin
      .from("contacts")
      .select("workspace_id")
      .eq("wa_phone", "+34600000001")
      .in("workspace_id", [wsA, wsB]);

    expect(data).toHaveLength(2);
  });

  it("no se puede modificar un contacto de otro workspace", async () => {
    await scoped(wsB).from("contacts").update({ name: "Secuestrado" });

    const { data } = await scoped(wsA).from("contacts").select("name");
    expect(nombresDe(data)[0]).toBe("Ana de A");
  });

  it("no se puede borrar un contacto de otro workspace", async () => {
    await scoped(wsB).from("contacts").delete();

    const { data } = await scoped(wsA).from("contacts").select("name");
    expect(data).toHaveLength(1);
  });

  it("un insert siempre acaba en el workspace del scope", async () => {
    // Aunque se intente colar otro workspace_id a mano, gana el del scope.
    await scoped(wsA)
      .from("contacts")
      .insert({ wa_phone: "+34600000002", name: "Intruso", workspace_id: wsB });

    const { data: enB } = await scoped(wsB).from("contacts").select("name");
    expect(nombresDe(enB)).not.toContain("Intruso");

    const { data: enA } = await scoped(wsA).from("contacts").select("name");
    expect(nombresDe(enA)).toContain("Intruso");
  });

  it("un update no puede mover una fila a otro workspace", async () => {
    await scoped(wsA).from("contacts").update({ workspace_id: wsB, name: "Ana movida" });

    const { data: enA } = await scoped(wsA).from("contacts").select("name");
    expect(enA?.length).toBeGreaterThan(0);
  });
});

describe("validación del workspace", () => {
  it("rechaza un workspace vacío", () => {
    // Sin esto, un undefined convertido en cadena vacía produciría una consulta
    // que no filtra nada y el aislamiento se caería en silencio.
    expect(() => scoped("")).toThrow();
  });

  it("rechaza algo que no sea un uuid", () => {
    expect(() => scoped("cualquier-cosa")).toThrow();
  });

  it("raw() exige un motivo", () => {
    expect(() => scoped(wsA).raw("")).toThrow();
  });
});
