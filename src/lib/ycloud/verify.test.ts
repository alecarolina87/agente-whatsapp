import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { VENTANA_ANTIRREPLAY_SEGUNDOS, verificarFirma } from "./verify";

const SECRETO = "secreto-de-prueba-del-workspace";
const CUERPO = JSON.stringify({
  id: "evt_123",
  type: "whatsapp.inbound_message.received",
});

/** Construye una cabecera válida, igual que la construiría YCloud. */
function cabeceraValida(cuerpo = CUERPO, ahora = Date.now()) {
  const t = Math.floor(ahora / 1000);
  const s = createHmac("sha256", SECRETO).update(`${t}.${cuerpo}`).digest("hex");
  return `t=${t},s=${s}`;
}

describe("verificarFirma", () => {
  it("acepta una firma legítima", () => {
    const ahora = Date.now();
    expect(
      verificarFirma({
        cuerpoCrudo: CUERPO,
        cabecera: cabeceraValida(CUERPO, ahora),
        secreto: SECRETO,
        ahora,
      }),
    ).toEqual({ valida: true });
  });

  it("rechaza cuando no hay cabecera", () => {
    expect(
      verificarFirma({ cuerpoCrudo: CUERPO, cabecera: null, secreto: SECRETO }),
    ).toEqual({ valida: false, motivo: "sin_cabecera" });
  });

  it("rechaza una cabecera con formato que no reconoce", () => {
    expect(
      verificarFirma({
        cuerpoCrudo: CUERPO,
        cabecera: "esto-no-es-una-firma",
        secreto: SECRETO,
      }),
    ).toEqual({ valida: false, motivo: "formato_invalido" });
  });

  it("rechaza el secreto equivocado", () => {
    const ahora = Date.now();
    expect(
      verificarFirma({
        cuerpoCrudo: CUERPO,
        cabecera: cabeceraValida(CUERPO, ahora),
        secreto: "otro-secreto",
        ahora,
      }),
    ).toEqual({ valida: false, motivo: "no_coincide" });
  });

  /*
   * El caso que justifica leer el cuerpo crudo: mismo contenido semántico, otra
   * serialización, y la firma ya no vale. Si el webhook parsea y vuelve a
   * serializar antes de verificar, esto es exactamente lo que le pasaría con
   * cada mensaje legítimo.
   */
  it("rechaza si el cuerpo se ha vuelto a serializar", () => {
    const ahora = Date.now();
    const cabecera = cabeceraValida(CUERPO, ahora);
    const reserializado = JSON.stringify(JSON.parse(CUERPO), null, 2);

    expect(
      verificarFirma({
        cuerpoCrudo: reserializado,
        cabecera,
        secreto: SECRETO,
        ahora,
      }),
    ).toEqual({ valida: false, motivo: "no_coincide" });
  });

  describe("ventana antirreplay", () => {
    it("acepta justo dentro de la ventana", () => {
      const firmado = Date.now();
      const ahora = firmado + (VENTANA_ANTIRREPLAY_SEGUNDOS - 1) * 1000;

      expect(
        verificarFirma({
          cuerpoCrudo: CUERPO,
          cabecera: cabeceraValida(CUERPO, firmado),
          secreto: SECRETO,
          ahora,
        }),
      ).toEqual({ valida: true });
    });

    it("rechaza una petición reenviada más tarde", () => {
      const firmado = Date.now();
      const ahora = firmado + (VENTANA_ANTIRREPLAY_SEGUNDOS + 60) * 1000;

      expect(
        verificarFirma({
          cuerpoCrudo: CUERPO,
          cabecera: cabeceraValida(CUERPO, firmado),
          secreto: SECRETO,
          ahora,
        }),
      ).toEqual({ valida: false, motivo: "fuera_de_ventana" });
    });

    /* Un reloj adelantado alargaría la ventana sin que nadie se dé cuenta. */
    it("rechaza también los timestamps del futuro", () => {
      const firmado = Date.now() + (VENTANA_ANTIRREPLAY_SEGUNDOS + 60) * 1000;

      expect(
        verificarFirma({
          cuerpoCrudo: CUERPO,
          cabecera: cabeceraValida(CUERPO, firmado),
          secreto: SECRETO,
          ahora: Date.now(),
        }),
      ).toEqual({ valida: false, motivo: "fuera_de_ventana" });
    });
  });

  it("acepta la firma en mayúsculas", () => {
    const ahora = Date.now();
    const cabecera = cabeceraValida(CUERPO, ahora).replace(
      /s=([0-9a-f]+)/,
      (_, hex) => `s=${hex.toUpperCase()}`,
    );

    expect(
      verificarFirma({ cuerpoCrudo: CUERPO, cabecera, secreto: SECRETO, ahora }),
    ).toEqual({ valida: true });
  });

  it("rechaza una firma con el largo cambiado", () => {
    const ahora = Date.now();
    const cabecera = cabeceraValida(CUERPO, ahora).replace(/s=([0-9a-f]+)/, "s=abc123");

    expect(
      verificarFirma({ cuerpoCrudo: CUERPO, cabecera, secreto: SECRETO, ahora }),
    ).toEqual({ valida: false, motivo: "no_coincide" });
  });
});
