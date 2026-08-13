/**
 * Lo que el agente puede hacer, además de escribir.
 *
 * ## Por qué el catálogo vive en el código
 *
 * Misma decisión que con los modelos: una tabla de catálogo hay que mantenerla
 * a mano y acaba desincronizada del código que la ejecuta. Aquí, añadir una
 * capacidad es añadir una entrada y su función; en la base de datos solo queda
 * qué tiene activado cada negocio.
 *
 * ## Por qué está separado del ejecutor
 *
 * Lo necesitan las dos orillas: el servidor para armar la petición al modelo, y
 * el navegador para pintar la pantalla de ajustes. El ejecutor es `server-only`
 * porque toca la base de datos. Es el mismo reparto que en `agent/catalogo.ts`.
 */

/** Un campo que hay que rellenar para que la herramienta sirva. */
export type CampoConfig = {
  clave: string;
  etiqueta: string;
  /** Qué pasa si se deja vacío. Se enseña bajo el campo. */
  ayuda: string;
  marcador: string;
  tipo: "url" | "texto";
};

export type Herramienta = {
  clave: string;
  nombre: string;
  /** Para qué sirve, dicho para quien lo contrata, no para el modelo. */
  descripcion: string;
  /**
   * Lo que lee el modelo para decidir cuándo usarla.
   *
   * Se escribe aparte de `descripcion` a propósito: son dos públicos con
   * necesidades distintas. Al modelo hay que decirle **cuándo** llamarla, no
   * qué valor aporta al negocio.
   */
  paraElModelo: string;
  /**
   * `lectura` no cambia nada fuera; `escritura` sí.
   *
   * Se marca porque no es lo mismo dar un enlace que crear una cita en la
   * agenda de alguien. Con `escritura`, la pantalla avisa antes de activarla.
   */
  efecto: "lectura" | "escritura";
  config: CampoConfig[];
};

export const HERRAMIENTAS: Herramienta[] = [
  {
    clave: "enlace_de_reservas",
    nombre: "Dar el enlace de reservas",
    descripcion:
      "Cuando alguien quiere pedir cita, el agente le pasa el enlace de la agenda en ese mismo mensaje, mientras está decidida. Es la diferencia entre «entra en nuestra web» y que reserve.",
    paraElModelo:
      "Devuelve el enlace donde el contacto puede reservar cita por su cuenta. Úsala en cuanto alguien pida cita, pregunte por disponibilidad o diga que quiere reservar. No inventes el enlace: llama siempre a esta herramienta.",
    efecto: "lectura",
    config: [
      {
        clave: "enlace",
        etiqueta: "Enlace de la agenda",
        ayuda:
          "El que usan tus clientas para reservar solas. Sin esto, la herramienta no se activa: es mejor que el agente diga que no lo sabe a que se invente una dirección.",
        marcador: "https://calendario.tunegocio.com",
        tipo: "url",
      },
    ],
  },
];

export function buscarHerramienta(clave: string): Herramienta | null {
  return HERRAMIENTAS.find((h) => h.clave === clave) ?? null;
}

/**
 * ¿Está lista para usarse?
 *
 * Activarla no basta: sin su configuración, el agente llamaría a una
 * herramienta que devuelve un hueco. Se comprueba aquí y no en cada sitio para
 * que la pantalla de ajustes y el motor coincidan siempre.
 */
export function estaCompleta(
  herramienta: Herramienta,
  config: Record<string, unknown>,
): boolean {
  return herramienta.config.every((campo) => {
    const valor = config[campo.clave];
    return typeof valor === "string" && valor.trim().length > 0;
  });
}
