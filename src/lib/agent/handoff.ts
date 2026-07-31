/**
 * Paso a una persona.
 *
 * ## Cómo sabe el agente que tiene que rendirse
 *
 * Se le pide al modelo que termine su mensaje con una marca cuando no puede
 * seguir. Luego se quita la marca antes de enviar: el cliente no debe verla.
 *
 * ## Por qué una marca y no una llamada aparte
 *
 * La alternativa sería preguntarle a un modelo, después de cada respuesta, "¿ha
 * hecho falta un humano aquí?". Eso **duplica el coste de cada mensaje** para
 * responder algo que el propio modelo ya sabe mientras escribe.
 *
 * La alternativa buena de verdad es *tool calling* —que el modelo llame a una
 * función `pedir_humano()`— y llega en F5 con la capa de tools. Hasta entonces
 * esto cuesta cero y funciona.
 *
 * ## Por qué se comprueba también lo que escribe el cliente
 *
 * Porque "quiero hablar con una persona" no puede depender de que el modelo
 * acierte. Cuando alguien lo pide con esas palabras, se pasa y punto: es la
 * petición más clara que existe y no merece un intermediario probabilístico.
 */

/** La marca que el modelo añade al final cuando necesita ayuda. */
export const MARCA_HANDOFF = "[HANDOFF]";

export type MotivoHandoff = "lo_pide_el_contacto" | "el_agente_se_rinde";

export type ResultadoHandoff = {
  /** El texto ya sin la marca, listo para enviar. */
  texto: string;
  /** `null` si no hay que pasar a nadie. */
  motivo: MotivoHandoff | null;
};

/*
 * Formas de pedir un humano en español. Deliberadamente cortas y frecuentes:
 * una lista larga empieza a disparar con frases que no lo piden.
 *
 * No cubre todos los casos, y no pasa nada: lo que esta lista no pille, lo
 * pillará el modelo con su marca. Son dos redes, no una.
 */
const PETICIONES_DE_HUMANO = [
  "hablar con una persona",
  "hablar con alguien",
  "hablar con un humano",
  "hablar con un agente",
  "atienda una persona",
  "atiende una persona",
  // Las dos conjugaciones: un test cazó que solo estaba el subjuntivo
  // ("me atienda alguien") y la gente escribe el indicativo ("me atiende
  // alguien"). El verbo entero se queda fuera a propósito: "alguien" a secas
  // dispararía con "¿hay alguien de guardia?", que no pide ningún humano.
  "atienda alguien",
  "atiende alguien",
  "quiero un humano",
  "pasame con",
  "pásame con",
  "operador",
];

/** Normaliza para comparar sin tildes ni mayúsculas. */
function sinTildes(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function pideHablarConUnaPersona(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const limpio = sinTildes(texto);
  return PETICIONES_DE_HUMANO.some((p) => limpio.includes(sinTildes(p)));
}

/**
 * Mira la respuesta del modelo y el último mensaje del contacto, y decide.
 *
 * Devuelve siempre el texto limpio, haya handoff o no: la marca nunca debe
 * llegar al cliente, ni siquiera si algo falla más adelante.
 */
export function evaluarHandoff({
  respuestaDelModelo,
  ultimoMensajeDelContacto,
}: {
  respuestaDelModelo: string;
  ultimoMensajeDelContacto?: string | null;
}): ResultadoHandoff {
  const traeMarca = respuestaDelModelo.includes(MARCA_HANDOFF);

  /*
   * Se quita en cualquier caso, y con lo que la rodee: los modelos a veces la
   * ponen en su propia línea, a veces la pegan al final de la frase.
   */
  const texto = respuestaDelModelo
    .split(MARCA_HANDOFF)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Lo que pide el contacto manda sobre lo que decida el modelo.
  if (pideHablarConUnaPersona(ultimoMensajeDelContacto)) {
    return { texto, motivo: "lo_pide_el_contacto" };
  }

  return { texto, motivo: traeMarca ? "el_agente_se_rinde" : null };
}

/** Texto para la pantalla y para los logs. */
export function explicarHandoff(motivo: MotivoHandoff): string {
  return motivo === "lo_pide_el_contacto"
    ? "El contacto pidió hablar con una persona."
    : "El agente no supo continuar.";
}
