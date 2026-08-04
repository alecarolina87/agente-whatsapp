import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * El DNS también se simula.
 *
 * Sin esto, los tests salen a resolver dominios de verdad: fallan sin internet
 * y, peor, podrían pasar o fallar según lo que devuelva un servidor ajeno. Un
 * test que depende de la red no prueba el código, prueba la conexión.
 *
 * `localhost` se resuelve a 127.0.0.1, como haría el sistema, para que el test
 * de que no se visita el propio servidor siga probando algo de verdad.
 */
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (nombre: string) =>
    nombre === "localhost"
      ? [{ address: "127.0.0.1", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
  ),
}));

import { leerPagina } from "./leer-pagina";

/*
 * Sin esto, el espía de `fetch` de un test sigue vivo en el siguiente y sus
 * llamadas se acumulan: un test que comprueba «no se llamó a fetch» falla por
 * culpa del test anterior, no por el código.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Estos tests protegen contra un SSRF.
 *
 * La dirección la escribe una persona y quien la visita es el servidor, desde
 * dentro de la red del proveedor. Sin control, se le podría pedir que fuera a
 * los metadatos de la nube —donde viven credenciales— y devolviera lo que
 * encontrase.
 *
 * Por eso lo que se comprueba es que **ni siquiera lo intente**: si `fetch`
 * llega a llamarse con una dirección interna, la protección ya falló.
 */
describe("leerPagina · a dónde NO va", () => {
  it.each([
    ["metadatos de la nube", "http://169.254.169.254/latest/meta-data/"],
    ["loopback", "http://127.0.0.1:3000/api/internal/flush"],
    ["localhost por nombre", "http://localhost:3000/"],
    ["red privada 10", "http://10.0.0.5/"],
    ["red privada 192.168", "http://192.168.1.1/"],
    ["red privada 172.16", "http://172.20.0.3/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv4 disfrazada de IPv6", "http://[::ffff:127.0.0.1]/"],
  ])("no visita %s", async (_nombre, url) => {
    const espia = vi.spyOn(globalThis, "fetch");

    const r = await leerPagina(url);

    expect(r.ok).toBe(false);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it.each([
    ["un archivo del disco", "file:///C:/Users/rodbe/.env"],
    ["datos incrustados", "data:text/html,<h1>hola</h1>"],
  ])("rechaza %s", async (_nombre, url) => {
    const espia = vi.spyOn(globalThis, "fetch");

    const r = await leerPagina(url);

    expect(r.ok).toBe(false);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it("dice que la dirección no vale cuando no es ni una URL", async () => {
    const r = await leerPagina("esto no es una dirección");
    expect(r.ok).toBe(false);
  });
});

describe("leerPagina · lo que devuelve", () => {
  /*
   * Se simula la red: estos tests no deben depender de que exista una web ni
   * de tener internet.
   */
  function responderCon(html: string, tipo = "text/html") {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200, headers: { "content-type": tipo } }),
    );
  }

  it("saca el texto y tira scripts, estilos y etiquetas", async () => {
    const espia = responderCon(`
      <html><head><style>.a{color:red}</style><script>alert(1)</script></head>
      <body>
        <h1>Clínica Dental One</h1>
        <p>Ortodoncia invisible en el centro de Palma de Mallorca desde 2014.</p>
        <p>La primera visita de valoración es gratuita y sin compromiso.</p>
        <p>Financiamos hasta en doce meses sin intereses.</p>
      </body></html>
    `);

    const r = await leerPagina("https://ejemplo.com");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toContain("Clínica Dental One");
    expect(r.texto).toContain("La primera visita de valoración es gratuita");
    expect(r.texto).not.toContain("alert(1)");
    expect(r.texto).not.toContain("color:red");
    expect(r.texto).not.toContain("<p>");
    espia.mockRestore();
  });

  it("separa los bloques en líneas y no los pega en una frase", async () => {
    const espia = responderCon(
      "<div>Servicios</div><div>Implantes dentales, ortodoncia invisible y blanqueamiento en Palma de Mallorca.</div>",
    );

    const r = await leerPagina("https://ejemplo.com");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).not.toContain("Servicios Implantes");
    espia.mockRestore();
  });

  it("le pone esquema a un dominio escrito a secas", async () => {
    const espia = responderCon("<p>Una web con texto suficiente para pasar el mínimo de ochenta caracteres que se exige.</p>");

    const r = await leerPagina("ejemplo.com");

    expect(r.ok).toBe(true);
    expect(espia.mock.calls[0][0]?.toString()).toMatch(/^https:\/\/ejemplo\.com/);
    espia.mockRestore();
  });

  /*
   * El caso más frecuente de fallo real: webs hechas con JavaScript que sirven
   * un HTML vacío. Merece un mensaje propio porque el cliente ve su web llena.
   */
  it("explica por qué no hay texto cuando la web lo pinta con JavaScript", async () => {
    const espia = responderCon('<div id="root"></div>');

    const r = await leerPagina("https://ejemplo.com");

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("JavaScript");
    espia.mockRestore();
  });

  it("rechaza lo que no sea una página web", async () => {
    const espia = responderCon("%PDF-1.7", "application/pdf");

    const r = await leerPagina("https://ejemplo.com/folleto.pdf");

    expect(r.ok).toBe(false);
    espia.mockRestore();
  });
});
