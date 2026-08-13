/**
 * Qué puede disparar una automatización y qué puede hacer.
 *
 * ## Este archivo no lleva `server-only`, y es a propósito
 *
 * Lo lee la pantalla de automatizaciones, que es un componente de cliente.
 * Poner `server-only` aquí rompería la compilación entera — ya pasó dos veces,
 * con el catálogo de modelos y con el de capacidades. Aquí solo hay datos: lo
 * que ejecuta vive en `motor.ts`, que sí es de servidor.
 *
 * ## La regla que decide qué entra en estas listas
 *
 * **Solo lo que se ejecuta de principio a fin.** El fork tiene seis
 * disparadores y cinco acciones guardándose en una tabla que nadie lee: el
 * cliente configura un recordatorio, se queda tranquilo, y no pasa nada nunca.
 * Un desplegable corto que funciona vale más que uno largo que miente.
 */

export type CampoConfig = {
  clave: string;
  etiqueta: string;
  tipo: "numero" | "texto" | "plantilla";
  ayuda: string;
  marcador?: string;
  min?: number;
  max?: number;
  pordefecto?: string;
};

export type Disparador = {
  clave: string;
  nombre: string;
  /** Qué tiene que pasar, contado para quien lo va a configurar. */
  descripcion: string;
  /**
   * `tiempo` lo comprueba el barrido cada diez minutos; `evento` salta en el
   * momento, desde el webhook. Cambia dónde se engancha, no cómo se guarda.
   */
  clase: "tiempo" | "evento";
  config: CampoConfig[];
  /** Qué acciones tienen sentido con este disparador. */
  acciones: string[];
};

export type Accion = {
  clave: string;
  nombre: string;
  descripcion: string;
  config: CampoConfig[];
  /** `true` si sale de la plataforma y llega a la clienta. */
  escribeAlContacto: boolean;
};

export const DISPARADORES: Disparador[] = [
  {
    clave: "sin_respuesta",
    nombre: "Se quedó sin contestar",
    descripcion:
      "Le contestamos y no ha vuelto a escribir en las horas que digas. Es el que recupera las conversaciones que se quedaron a medias.",
    clase: "tiempo",
    config: [
      {
        clave: "horas",
        etiqueta: "Horas de silencio",
        tipo: "numero",
        min: 1,
        max: 720,
        pordefecto: "24",
        ayuda:
          "Pasadas 24 h, WhatsApp solo deja escribir con una plantilla aprobada. Por debajo de 24 también se puede, pero recuerda que cada plantilla se paga.",
      },
    ],
    acciones: ["enviar_plantilla", "poner_etiqueta", "pasar_a_persona"],
  },
  {
    clave: "primer_mensaje",
    nombre: "Escribe por primera vez",
    descripcion:
      "Un número que no estaba en la agenda escribe. Sirve para tener localizados a los nuevos sin ir mirando la bandeja.",
    clase: "evento",
    config: [],
    // Sin plantilla: quien acaba de escribir tiene la ventana abierta y el
    // agente ya le está contestando gratis. Pagar por una plantilla ahí sería
    // tirar el dinero, y además llegaría después de la respuesta.
    acciones: ["poner_etiqueta", "pasar_a_persona"],
  },
];

export const ACCIONES: Accion[] = [
  {
    clave: "enviar_plantilla",
    nombre: "Mandar una plantilla",
    descripcion:
      "El único mensaje que WhatsApp deja enviar cuando ya han pasado 24 h. Tiene que estar aprobada por Meta.",
    escribeAlContacto: true,
    config: [
      {
        clave: "plantillaId",
        etiqueta: "Qué plantilla",
        tipo: "plantilla",
        ayuda:
          "Solo salen las aprobadas. Los huecos se rellenan con el mismo texto para todo el mundo, así que una plantilla con la fecha de la cita no vale para esto.",
      },
    ],
  },
  {
    clave: "poner_etiqueta",
    nombre: "Poner una etiqueta al contacto",
    descripcion:
      "No le llega nada a la clienta. Sirve para encontrarlos luego: «pendiente», «nuevo», «se enfrió».",
    escribeAlContacto: false,
    config: [
      {
        clave: "etiqueta",
        etiqueta: "Etiqueta",
        tipo: "texto",
        marcador: "pendiente",
        ayuda: "Si ya la tiene, no se duplica.",
      },
    ],
  },
  {
    clave: "pasar_a_persona",
    nombre: "Pasarla a una persona",
    descripcion:
      "Aparece en «te esperan a ti» y el agente deja de contestar en esa conversación. Tampoco le llega nada a la clienta.",
    escribeAlContacto: false,
    config: [],
  },
];

export function buscarDisparador(clave: string): Disparador | null {
  return DISPARADORES.find((d) => d.clave === clave) ?? null;
}

export function buscarAccion(clave: string): Accion | null {
  return ACCIONES.find((a) => a.clave === clave) ?? null;
}

/**
 * Qué acciones admite un disparador.
 *
 * No es decoración de la pantalla: el mismo filtro se aplica al guardar. Sin
 * él, una regla creada desde fuera podría pedir una plantilla para alguien que
 * acaba de escribir — legal, pero pagando por lo que era gratis.
 */
export function accionesDe(claveDisparador: string): Accion[] {
  const disparador = buscarDisparador(claveDisparador);
  if (!disparador) return [];

  return disparador.acciones.flatMap((clave) => {
    const accion = buscarAccion(clave);
    return accion ? [accion] : [];
  });
}

export function admite(claveDisparador: string, claveAccion: string): boolean {
  return accionesDe(claveDisparador).some((a) => a.clave === claveAccion);
}

/**
 * Comprueba que estén todos los datos que pide una lista de campos.
 *
 * Lo mismo que con las capacidades: una regla a medio configurar que se activa
 * es peor que una desactivada, porque parece que está funcionando.
 */
export function configCompleta(
  campos: CampoConfig[],
  valores: Record<string, unknown>,
): boolean {
  return campos.every((campo) => {
    const valor = valores[campo.clave];
    if (typeof valor !== "string") return false;
    if (!valor.trim()) return false;

    if (campo.tipo === "numero") {
      const n = Number(valor);
      if (!Number.isFinite(n)) return false;
      if (campo.min !== undefined && n < campo.min) return false;
      if (campo.max !== undefined && n > campo.max) return false;
    }

    return true;
  });
}

/** Lo que se lee de la regla ya guardada, en la lista y en el motor. */
export function describirRegla(
  claveDisparador: string,
  claveAccion: string,
): string {
  const d = buscarDisparador(claveDisparador);
  const a = buscarAccion(claveAccion);

  if (!d || !a) return "Esta regla usa algo que ya no existe. Bórrala.";
  return `${d.nombre} → ${a.nombre.toLowerCase()}`;
}
