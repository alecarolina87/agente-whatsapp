import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Descarga una página web y devuelve su texto.
 *
 * ## Lo que hace peligroso a este archivo
 *
 * La dirección la escribe una persona, y quien la descarga es **el servidor**,
 * desde dentro de la red del proveedor. Sin control, alguien podría pedirle que
 * fuera a `http://169.254.169.254/` —los metadatos de la nube, donde viven
 * credenciales— o a un servicio interno, y se le devolvería el contenido.
 *
 * Eso es un SSRF, y es de los agujeros más comunes en cualquier función que
 * «lee una web». Por eso aquí se resuelve el nombre a su IP **antes** de pedir
 * nada, y se comprueba en cada redirección: un dominio público puede apuntar a
 * 127.0.0.1, y muchos comprobadores solo miran la primera dirección.
 */

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECCIONES = 3;

/** Cuánto texto se conserva. Lo que va al modelo se paga por tokens. */
const MAX_CARACTERES = 14_000;

export type ResultadoLectura =
  | { ok: true; texto: string; urlFinal: string }
  | { ok: false; motivo: string };

/**
 * Rangos que nunca deben alcanzarse desde aquí.
 *
 * No es una lista de «sitios malos»: es todo lo que no está en internet
 * público. Una web de un cliente jamás resuelve a una de estas.
 */
function esPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    // Loopback, enlace local y direcciones únicas locales.
    if (v6 === "::1" || v6 === "::" || v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) {
      return true;
    }

    /*
     * IPv4 disfrazada de IPv6. Y aquí está el detalle que se me escapó: `URL`
     * **normaliza** `::ffff:127.0.0.1` a `::ffff:7f00:1`, en hexadecimal. Solo
     * mirar el formato con puntos dejaba pasar `http://[::ffff:127.0.0.1]/`
     * hasta el `fetch`. Lo cazó su test.
     */
    const conPuntos = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (conPuntos) return esPrivada(conPuntos[1]);

    const enHex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (enHex) {
      const alto = parseInt(enHex[1], 16);
      const bajo = parseInt(enHex[2], 16);
      const comoV4 = [alto >> 8, alto & 0xff, bajo >> 8, bajo & 0xff].join(".");
      return esPrivada(comoV4);
    }

    return false;
  }

  const [a, b] = ip.split(".").map(Number);

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // metadatos de la nube
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // NAT del operador
    a >= 224 // multicast y reservadas
  );
}

/** Comprueba que el nombre de una URL resuelva a una dirección pública. */
async function destinoSeguro(url: URL): Promise<string | null> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "solo se pueden leer direcciones http o https";
  }

  /*
   * Los corchetes de una IPv6 forman parte de `hostname` (`[::1]`), y con
   * ellos `isIP` dice que no es una IP. Sin quitarlos, `http://[::1]/` se
   * trataba como un dominio, se resolvía por DNS y **se colaba**: era un SSRF
   * de manual, y lo cazó su test.
   */
  const anfitrion = url.hostname.replace(/^\[|\]$/g, "");

  // Una IP escrita a mano no pasa por DNS, así que se comprueba tal cual.
  if (isIP(anfitrion)) {
    return esPrivada(anfitrion) ? "esa dirección no es pública" : null;
  }

  let direcciones;
  try {
    direcciones = await lookup(anfitrion, { all: true });
  } catch {
    return "no se pudo resolver ese dominio";
  }

  // Todas, no solo la primera: un dominio puede devolver varias y bastaría con
  // que una fuera interna para que el intento tuviera éxito de vez en cuando.
  if (direcciones.some((d) => esPrivada(d.address))) {
    return "ese dominio apunta a una dirección que no es pública";
  }

  return null;
}

/** Quita de la página todo lo que no es texto que lea una persona. */
function aTextoPlano(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    // Los saltos de bloque se conservan: sin ellos, un menú y un párrafo
    // acaban pegados en la misma línea y el modelo los lee como una frase.
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export async function leerPagina(direccion: string): Promise<ResultadoLectura> {
  let url: URL;
  try {
    /*
     * Un dominio copiado a mano viene sin esquema, así que se le pone `https`.
     * Pero solo si **no traía ninguno**: comprobar únicamente `http://` hacía
     * que `file:///…` se convirtiera en `https://file:///…`, con el host
     * `file`, y de ahí pasaba a resolverse por DNS en vez de rechazarse.
     */
    const traeEsquema = /^[a-z][a-z0-9+.-]*:/i.test(direccion.trim());
    url = new URL(traeEsquema ? direccion.trim() : `https://${direccion.trim()}`);
  } catch {
    return { ok: false, motivo: "Esa dirección no parece válida." };
  }

  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto += 1) {
    const problema = await destinoSeguro(url);
    if (problema) return { ok: false, motivo: problema };

    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        // A mano: cada redirección se vuelve a comprobar. Con `follow`, el
        // primer salto se validaría y los siguientes no.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // Identificarse es de buena educación y evita que algunos servidores
          // devuelvan un 403 a un cliente sin nombre.
          "User-Agent": "AgenteWhatsApp/1.0 (+lectura de la web del propio cliente)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (error) {
      const causa = error instanceof Error ? error.message : "desconocida";
      return { ok: false, motivo: `No se pudo abrir la página (${causa}).` };
    }

    if (respuesta.status >= 300 && respuesta.status < 400) {
      const destino = respuesta.headers.get("location");
      if (!destino) return { ok: false, motivo: "La página redirige a ninguna parte." };
      url = new URL(destino, url);
      continue;
    }

    if (!respuesta.ok) {
      return { ok: false, motivo: `La página respondió ${respuesta.status}.` };
    }

    const tipo = respuesta.headers.get("content-type") ?? "";
    if (!tipo.includes("html") && !tipo.includes("text/plain")) {
      return { ok: false, motivo: "Esa dirección no es una página web." };
    }

    const declarado = Number(respuesta.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > MAX_BYTES) {
      return { ok: false, motivo: "La página es demasiado grande." };
    }

    const html = await respuesta.text();
    if (html.length > MAX_BYTES) {
      return { ok: false, motivo: "La página es demasiado grande." };
    }

    const texto = aTextoPlano(html);

    if (texto.length < 80) {
      /*
       * Casi siempre es una web hecha con JavaScript: el HTML llega vacío y el
       * contenido lo pinta el navegador. Merece un mensaje propio porque el
       * usuario ve su web llena y aquí le diríamos que no hay nada.
       */
      return {
        ok: false,
        motivo:
          "No se pudo sacar texto de esa página. Suele pasar con webs que cargan " +
          "el contenido con JavaScript. Copia y pega el texto a mano.",
      };
    }

    return { ok: true, texto: texto.slice(0, MAX_CARACTERES), urlFinal: url.toString() };
  }

  return { ok: false, motivo: "La página redirige demasiadas veces." };
}
