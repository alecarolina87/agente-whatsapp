import { describe, expect, it, vi } from "vitest";

import { enlaceDeConfianza, guardarAdjunto } from "./media";

/**
 * Estos tests protegen la parte de seguridad del módulo.
 *
 * El enlace del archivo llega **dentro del cuerpo del webhook**, así que es
 * dato de fuera. Si el servidor descargara cualquier URL que le pongan ahí,
 * sería un SSRF: se le podría pedir que fuera a la red interna de Vercel o a
 * los metadatos del proveedor y guardara la respuesta en el bucket.
 */
describe("enlaceDeConfianza", () => {
  it("acepta los enlaces de YCloud por HTTPS", () => {
    expect(enlaceDeConfianza("https://api.ycloud.com/v2/whatsapp/media/abc")).toBe(true);
    expect(enlaceDeConfianza("https://API.YCloud.com/v2/media/abc")).toBe(true);
  });

  it("rechaza los hosts que solo se parecen", () => {
    // El caso que rompería un `startsWith` o un `includes`.
    expect(enlaceDeConfianza("https://api.ycloud.com.atacante.net/f")).toBe(false);
    expect(enlaceDeConfianza("https://atacante.net/api.ycloud.com")).toBe(false);
    expect(enlaceDeConfianza("https://ycloud.com/f")).toBe(false);
    // Las credenciales en la URL no convierten al host en otro.
    expect(enlaceDeConfianza("https://api.ycloud.com@atacante.net/f")).toBe(false);
  });

  it("rechaza lo que no sea HTTPS", () => {
    expect(enlaceDeConfianza("http://api.ycloud.com/f")).toBe(false);
    expect(enlaceDeConfianza("file:///C:/Users/rodbe/.env")).toBe(false);
    expect(enlaceDeConfianza("data:image/png;base64,iVBOR")).toBe(false);
  });

  it("rechaza la red interna y los metadatos del proveedor", () => {
    expect(enlaceDeConfianza("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(enlaceDeConfianza("https://localhost:3000/api/internal/flush")).toBe(false);
    expect(enlaceDeConfianza("https://10.0.0.1/")).toBe(false);
  });

  it("rechaza lo que ni siquiera es una URL", () => {
    expect(enlaceDeConfianza("")).toBe(false);
    expect(enlaceDeConfianza("api.ycloud.com/f")).toBe(false);
  });
});

describe("guardarAdjunto", () => {
  const base = { apiKey: "clave", workspaceId: "ws", conversacionId: "conv" };

  /*
   * Que un archivo no se pueda guardar no puede tumbar el webhook: el mensaje
   * de la clienta tiene que quedar registrado igual. Por eso el módulo
   * devuelve el fallo en vez de lanzarlo.
   */
  it("no descarga de un host que no sea YCloud, y ni siquiera lo intenta", async () => {
    const fetchEspia = vi.spyOn(globalThis, "fetch");

    const resultado = await guardarAdjunto({
      ...base,
      adjunto: { id: null, enlace: "https://atacante.net/f.png", mime: "image/png", nombre: null },
    });

    expect(resultado.ok).toBe(false);
    expect(fetchEspia).not.toHaveBeenCalled();
    fetchEspia.mockRestore();
  });

  it("avisa cuando el adjunto llega sin enlace", async () => {
    const resultado = await guardarAdjunto({
      ...base,
      adjunto: { id: "m1", enlace: null, mime: "image/jpeg", nombre: null },
    });

    expect(resultado).toEqual({
      ok: false,
      motivo: "el adjunto llegó sin enlace de descarga",
    });
  });

  // No se filtra el enlace entero en el registro: puede llevar credenciales.
  it("registra el host, no el enlace completo", async () => {
    const resultado = await guardarAdjunto({
      ...base,
      adjunto: {
        id: null,
        enlace: "https://atacante.net/f.png?token=secreto",
        mime: null,
        nombre: null,
      },
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toContain("atacante.net");
    expect(resultado.motivo).not.toContain("secreto");
  });
});
