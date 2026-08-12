/**
 * Formas de los datos del inbox.
 *
 * Están separadas de `inbox.ts` a propósito: ese archivo lleva
 * `import "server-only"`, que hace fallar la compilación si algo del navegador
 * lo importa. Es una protección que queremos —ahí dentro se usa la sesión y se
 * consulta la base de datos— pero los *tipos* sí los necesita el componente de
 * cliente que pinta la conversación.
 *
 * Sin esta separación, el componente arrastraba el módulo de servidor entero y
 * el compilador se caía con un error que no decía nada.
 */

export type ConversacionListada = {
  id: string;
  estado: string;
  iaActiva: boolean;
  sinLeer: number;
  ultimoMensajeEn: string | null;
  ventanaCaducaEn: string | null;
  contacto: { nombre: string | null; telefono: string };
  ultimoTexto: string | null;
};

/**
 * Si esta conversación está esperando a una persona.
 *
 * Son dos casos, y el segundo es el que se olvida:
 *
 * 1. El agente la traspasó —pidió ayuda, se la pidieron, o llegó una foto—.
 * 2. La IA está apagada y hay mensajes sin leer. Aquí no hay ningún aviso que
 *    salte: simplemente nadie va a contestar hasta que alguien entre. Es la
 *    forma más silenciosa de dejar tirada a una clienta.
 *
 * Vive aquí, junto a los tipos, para que la lista y el contador de la pestaña
 * cuenten exactamente lo mismo. Con dos definiciones, tarde o temprano una dice
 * «3» y la otra «2», y entonces ya no te fías de ninguna.
 */
export function necesitaPersona(c: ConversacionListada): boolean {
  return c.estado === "handoff_pending" || (!c.iaActiva && c.sinLeer > 0);
}

/**
 * ¿Coincide esta conversación con lo que se está buscando?
 *
 * Vive aquí, y no dentro del componente, por dos razones: la comparten la lista
 * y cualquier otra pantalla que busque conversaciones, y sobre todo **se puede
 * probar** — que es lo que hace falta, porque el caso del teléfono tiene más
 * trampa de la que parece.
 *
 * Se busca por nombre y por teléfono a la vez. Quien busca recuerda una cosa o
 * la otra y nunca sabe cuál va a funcionar; obligar a elegir campo antes de
 * escribir es pedirle que adivine.
 *
 * El teléfono se compara además **solo por dígitos**: está guardado como
 * `+34600000000` y la gente teclea `600 00 00 00`, o `600-000-000`. Sin esto,
 * la búsqueda por teléfono solo funcionaría escribiéndolo exactamente igual que
 * lo guardó el sistema, que es la forma en que nadie lo escribe.
 */
export function coincideBusqueda(
  c: ConversacionListada,
  texto: string,
): boolean {
  const buscado = texto.trim().toLowerCase();
  if (!buscado) return true;

  const nombre = c.contacto.nombre?.toLowerCase() ?? "";
  if (nombre.includes(buscado)) return true;

  const telefono = c.contacto.telefono.toLowerCase();
  if (telefono.includes(buscado)) return true;

  /*
   * Solo si lo tecleado tiene dígitos. Sin esta guarda, buscar «ana» dejaría
   * las dos cadenas vacías, `"".includes("")` sería `true` y coincidiría con
   * todo el mundo.
   */
  const digitosBuscados = buscado.replace(/\D/g, "");
  if (!digitosBuscados) return false;

  return telefono.replace(/\D/g, "").includes(digitosBuscados);
}

export type MensajeDelHilo = {
  id: string;
  direccion: "in" | "out";
  /** `contact`, `ai`, `human` o `system`. */
  quien: string;
  texto: string | null;
  tipo: string;
  estado: string;
  creadoEn: string;
};

export type HiloConversacion = {
  id: string;
  estado: string;
  iaActiva: boolean;
  ventanaCaducaEn: string | null;
  contacto: { nombre: string | null; telefono: string };
  mensajes: MensajeDelHilo[];
};
