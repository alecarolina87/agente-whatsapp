import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const completarChat = vi.fn();

vi.mock("@/lib/openrouter/client", () => ({
  completarChat: (...args: unknown[]) => completarChat(...args),
  ErrorOpenRouter: class ErrorOpenRouter extends Error {},
}));

vi.mock("@/lib/data/scoped", () => ({ scoped: () => ({}) }));

const { conversar } = await import("./conversar");

const MODELOS = { principal: "anthropic/claude-haiku-4.5", respaldo: null };
const RESERVAS = [{ clave: "enlace_de_reservas", config: { enlace: "https://citas.test" } }];

const respuesta = (extra: Record<string, unknown> = {}) => ({
  texto: "",
  modelo: MODELOS.principal,
  llamadas: [],
  uso: { entrada: 100, salida: 50, costeUsd: 0.001 },
  ...extra,
});

const llamada = (nombre: string, id = "call_1") => ({
  id,
  type: "function" as const,
  function: { name: nombre, arguments: "{}" },
});

describe("conversar", () => {
  it("sin herramientas, una sola llamada al modelo", async () => {
    completarChat.mockReset().mockResolvedValueOnce(respuesta({ texto: "Hola" }));

    const r = await conversar({
      apiKey: "k",
      modelos: MODELOS,
      mensajes: [{ role: "user", content: "hola" }],
      herramientas: [],
    });

    expect(r.respuesta.texto).toBe("Hola");
    expect(completarChat).toHaveBeenCalledTimes(1);
    expect(r.herramientasUsadas).toEqual([]);
  });

  it("ejecuta la herramienta y vuelve a llamar al modelo", async () => {
    completarChat
      .mockReset()
      .mockResolvedValueOnce(respuesta({ llamadas: [llamada("enlace_de_reservas")] }))
      .mockResolvedValueOnce(respuesta({ texto: "Aquí lo tienes: https://citas.test" }));

    const r = await conversar({
      apiKey: "k",
      modelos: MODELOS,
      mensajes: [{ role: "user", content: "quiero cita" }],
      herramientas: RESERVAS,
    });

    expect(completarChat).toHaveBeenCalledTimes(2);
    expect(r.herramientasUsadas).toEqual(["enlace_de_reservas"]);
    expect(r.respuesta.texto).toContain("citas.test");

    // La segunda llamada tiene que llevar la petición original y su resultado,
    // emparejados por identificador: sin eso el proveedor la rechaza.
    const segunda = completarChat.mock.calls[1][0];
    const roles = segunda.mensajes.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool"]);
    expect(segunda.mensajes[1].tool_calls[0].id).toBe("call_1");
    expect(segunda.mensajes[2].tool_call_id).toBe("call_1");
  });

  /*
   * El test que protege el tope de gasto. Cada vuelta es una llamada de pago;
   * si solo se contara la última, una respuesta que costó tres se apuntaría
   * como una — y el tope contaría de menos justo los días raros, que es cuando
   * existe para algo.
   */
  it("suma el coste de todas las vueltas, no solo el de la última", async () => {
    completarChat
      .mockReset()
      .mockResolvedValueOnce(respuesta({ llamadas: [llamada("enlace_de_reservas")] }))
      .mockResolvedValueOnce(respuesta({ texto: "listo" }));

    const r = await conversar({
      apiKey: "k",
      modelos: MODELOS,
      mensajes: [{ role: "user", content: "cita" }],
      herramientas: RESERVAS,
    });

    expect(r.respuesta.uso.costeUsd).toBeCloseTo(0.002);
    expect(r.respuesta.uso.entrada).toBe(200);
    expect(r.respuesta.uso.salida).toBe(100);
  });

  /*
   * El freno contra el bucle: un modelo confundido puede pedir la misma
   * herramienta indefinidamente. Sin tope, cada vuelta es dinero.
   */
  it("corta cuando se agotan las vueltas", async () => {
    completarChat.mockReset().mockResolvedValue(respuesta({ llamadas: [llamada("enlace_de_reservas")] }));

    const r = await conversar({
      apiKey: "k",
      modelos: MODELOS,
      mensajes: [{ role: "user", content: "cita" }],
      herramientas: RESERVAS,
    });

    // MAX_VUELTAS = 2 → tres llamadas como mucho (vueltas 0, 1 y 2).
    expect(completarChat).toHaveBeenCalledTimes(3);
    expect(r.seAgotaronLasVueltas).toBe(true);
  });

  it("en la última vuelta ya no ofrece herramientas", async () => {
    completarChat.mockReset().mockResolvedValue(respuesta({ llamadas: [llamada("enlace_de_reservas")] }));

    await conversar({
      apiKey: "k",
      modelos: MODELOS,
      mensajes: [{ role: "user", content: "cita" }],
      herramientas: RESERVAS,
    });

    // Ofrecerlas en la última dejaría al modelo pidiendo algo que ya nadie va
    // a ejecutar, y por tanto sin escribir nada.
    const ultima = completarChat.mock.calls.at(-1)![0];
    expect(ultima.herramientas).toBeUndefined();
  });

  it("una herramienta que el negocio no tiene no rompe la conversación", async () => {
    completarChat
      .mockReset()
      .mockResolvedValueOnce(respuesta({ llamadas: [llamada("inventada")] }))
      .mockResolvedValueOnce(respuesta({ texto: "Te paso con una persona" }));

    const r = await conversar({
      apiKey: "k",
      modelos: MODELOS,
      mensajes: [{ role: "user", content: "cita" }],
      herramientas: RESERVAS,
    });

    expect(r.respuesta.texto).toBe("Te paso con una persona");
    expect(r.herramientasUsadas).toEqual([]);
  });
});
