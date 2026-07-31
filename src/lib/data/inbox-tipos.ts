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
