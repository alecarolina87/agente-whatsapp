import { describe, expect, it, vi } from "vitest";

import { MODELOS, modeloValido } from "./catalogo";

/*
 * `modelos.ts` es `server-only` y arrastra el cliente de OpenRouter, así que
 * para probarlo hay que simular las dos cosas. `server-only` en un test de
 * Node explota; el cliente se simula para no llamar a nadie de verdad.
 */
vi.mock("server-only", () => ({}));

const completarChat = vi.fn();

vi.mock("@/lib/openrouter/client", () => ({
  completarChat: (...args: unknown[]) => completarChat(...args),
  ErrorOpenRouter: class ErrorOpenRouter extends Error {},
}));

const { completarConRespaldo, elegirModelos } = await import("./modelos");

const RAPIDO = MODELOS[0].id;
const EQUILIBRADO = MODELOS[1].id;
const PLATAFORMA = "anthropic/claude-haiku-4.5";

describe("elegirModelos", () => {
  it("usa el del negocio cuando está en el catálogo", () => {
    expect(
      elegirModelos({ modelo: EQUILIBRADO, modeloRespaldo: null, porDefecto: PLATAFORMA }),
    ).toEqual({ principal: EQUILIBRADO, respaldo: null });
  });

  it("cae al de la plataforma cuando el negocio no ha elegido", () => {
    expect(
      elegirModelos({ modelo: null, modeloRespaldo: null, porDefecto: PLATAFORMA }),
    ).toEqual({ principal: PLATAFORMA, respaldo: null });
  });

  /*
   * El caso que de verdad importa: los modelos se retiran. Si un negocio se
   * quedara apuntando a uno que ya no existe, fallaría en cada mensaje y su
   * agente se quedaría mudo por un cambio de catálogo, no por nada suyo.
   */
  it("ignora un modelo retirado y sigue atendiendo con el de la plataforma", () => {
    expect(
      elegirModelos({
        modelo: "anthropic/claude-2",
        modeloRespaldo: null,
        porDefecto: PLATAFORMA,
      }),
    ).toEqual({ principal: PLATAFORMA, respaldo: null });
  });

  it("descarta un respaldo igual que el principal", () => {
    expect(
      elegirModelos({ modelo: RAPIDO, modeloRespaldo: RAPIDO, porDefecto: PLATAFORMA }),
    ).toEqual({ principal: RAPIDO, respaldo: null });
  });

  it("descarta un respaldo que ya no está en el catálogo", () => {
    expect(
      elegirModelos({
        modelo: RAPIDO,
        modeloRespaldo: "openai/gpt-3.5-turbo",
        porDefecto: PLATAFORMA,
      }),
    ).toEqual({ principal: RAPIDO, respaldo: null });
  });

  /*
   * Sin ningún modelo configurado hay que devolver `null` para que quien llama
   * avise de que falta configuración. Si en su lugar se devolviera el principal
   * vacío, se llamaría a OpenRouter con `model: undefined` y el error llegaría
   * disfrazado de fallo del proveedor.
   *
   * Se pasa la cadena vacía y no `undefined` a propósito: `undefined` activa el
   * valor por defecto del parámetro, que lee el entorno — y en los tests el
   * entorno tiene modelo, así que no probaría nada.
   */
  it("devuelve null si no hay ni modelo del negocio ni de la plataforma", () => {
    expect(elegirModelos({ modelo: null, modeloRespaldo: null, porDefecto: "" })).toBeNull();
  });
});

describe("completarConRespaldo", () => {
  const mensajes = [{ role: "user" as const, content: "hola" }];
  const respuesta = {
    texto: "buenas",
    modelo: RAPIDO,
    uso: { entrada: 10, salida: 5, costeUsd: 0.0001 },
  };

  it("no llama al respaldo si el principal contesta", async () => {
    completarChat.mockReset().mockResolvedValueOnce(respuesta);

    const r = await completarConRespaldo({
      apiKey: "k",
      modelos: { principal: RAPIDO, respaldo: EQUILIBRADO },
      mensajes,
    });

    expect(r.falloDelPrincipal).toBeNull();
    expect(completarChat).toHaveBeenCalledTimes(1);
    expect(completarChat).toHaveBeenCalledWith(
      expect.objectContaining({ modelo: RAPIDO }),
    );
  });

  it("reintenta con el respaldo cuando el principal falla", async () => {
    completarChat
      .mockReset()
      .mockRejectedValueOnce(new Error("proveedor caído"))
      .mockResolvedValueOnce({ ...respuesta, modelo: EQUILIBRADO });

    const r = await completarConRespaldo({
      apiKey: "k",
      modelos: { principal: RAPIDO, respaldo: EQUILIBRADO },
      mensajes,
    });

    expect(r.respuesta.modelo).toBe(EQUILIBRADO);
    // Sin esto, un principal caído durante días no se notaría en ninguna parte.
    expect(r.falloDelPrincipal).toContain("proveedor caído");
    expect(completarChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ modelo: EQUILIBRADO }),
    );
  });

  it("propaga el error sin reintentar si no hay respaldo", async () => {
    completarChat.mockReset().mockRejectedValueOnce(new Error("proveedor caído"));

    await expect(
      completarConRespaldo({
        apiKey: "k",
        modelos: { principal: RAPIDO, respaldo: null },
        mensajes,
      }),
    ).rejects.toThrow("proveedor caído");

    expect(completarChat).toHaveBeenCalledTimes(1);
  });

  /*
   * Un respaldo no es una cadena de reintentos: si también falla, se para. Sin
   * este límite, un fallo general de OpenRouter multiplicaría la espera por
   * cada modelo del catálogo antes de rendirse.
   */
  it("no encadena más de un reintento", async () => {
    completarChat
      .mockReset()
      .mockRejectedValueOnce(new Error("cayó el principal"))
      .mockRejectedValueOnce(new Error("cayó el respaldo"));

    await expect(
      completarConRespaldo({
        apiKey: "k",
        modelos: { principal: RAPIDO, respaldo: EQUILIBRADO },
        mensajes,
      }),
    ).rejects.toThrow("cayó el respaldo");

    expect(completarChat).toHaveBeenCalledTimes(2);
  });
});

describe("catálogo", () => {
  it("no tiene identificadores repetidos", () => {
    expect(new Set(MODELOS.map((m) => m.id)).size).toBe(MODELOS.length);
  });

  it("el modelo por defecto de .env.example sigue en el catálogo", () => {
    // Si se retira de la lista, los negocios sin modelo propio se quedarían
    // apuntando a algo que la aplicación ya no ofrece.
    expect(modeloValido(PLATAFORMA)).toBe(true);
  });
});
