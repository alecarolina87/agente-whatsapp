import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación de la firma de los webhooks de YCloud.
 *
 * ## Por qué existe
 *
 * La URL del webhook es pública: cualquiera que la conozca puede enviarle una
 * petición. Lo único que distingue un evento real de YCloud de uno inventado es
 * esta firma. Sin ella, cualquiera podría meter mensajes falsos en la bandeja de
 * un cliente y hacer que el agente conteste a quien no debe.
 *
 * ## Cómo funciona
 *
 * La cabecera `YCloud-Signature` llega así:
 *
 *     t={segundosUnix},s={hmacSha256EnHex}
 *
 * Y lo que está firmado es la concatenación del timestamp, un punto y el cuerpo
 * **tal cual llegó**:
 *
 *     HMAC-SHA256( secreto , timestamp + "." + cuerpoCrudo )
 *
 * De ahí sale la regla más importante de todo el webhook: **hay que leer el
 * cuerpo como texto antes de parsearlo**. Si se convierte a JSON y se vuelve a
 * serializar, cambian los espacios o el orden de las claves y la firma deja de
 * coincidir aunque el mensaje sea legítimo.
 *
 * Contrato documentado en `SPIKE-ycloud.md` §2.
 */

/**
 * El resultado dice si la firma vale y, cuando no, por qué.
 *
 * El motivo **no se le devuelve a quien llama al webhook** —siempre 401 a
 * secas—, pero sí se guarda en `events`. Sin él, un webhook que empieza a
 * fallar solo dice "401" y no hay forma de distinguir un secreto mal copiado de
 * un reloj desincronizado o de un ataque real.
 */
export type ResultadoFirma =
  | { valida: true }
  | { valida: false; motivo: MotivoRechazo };

export type MotivoRechazo =
  | "sin_cabecera"
  | "formato_invalido"
  | "fuera_de_ventana"
  | "no_coincide";

/** Segundos de tolerancia entre el reloj de YCloud y el nuestro. */
export const VENTANA_ANTIRREPLAY_SEGUNDOS = 300;

/** Una firma SHA-256 en hexadecimal siempre ocupa 64 caracteres. */
const LARGO_FIRMA_HEX = 64;

export function verificarFirma({
  cuerpoCrudo,
  cabecera,
  secreto,
  ahora = Date.now(),
}: {
  /** El cuerpo tal cual llegó, sin parsear ni volver a serializar. */
  cuerpoCrudo: string;
  /** Contenido de la cabecera `YCloud-Signature`. */
  cabecera: string | null;
  /** Secreto del webhook de este workspace, sacado de Vault. */
  secreto: string;
  /**
   * Momento actual en milisegundos. Se puede inyectar para poder probar la
   * ventana antirreplay sin tocar el reloj del sistema.
   */
  ahora?: number;
}): ResultadoFirma {
  if (!cabecera) return { valida: false, motivo: "sin_cabecera" };

  const marca = cabecera.match(/t=(\d+)/);
  const firma = cabecera.match(/s=([0-9a-fA-F]+)/);
  if (!marca || !firma) return { valida: false, motivo: "formato_invalido" };

  const timestamp = marca[1];
  const recibida = firma[1].toLowerCase();

  /*
   * Antirreplay. Sin esta comprobación, alguien que capture una petición válida
   * puede reenviarla las veces que quiera: la firma seguiría siendo correcta
   * para siempre, porque el contenido no ha cambiado.
   *
   * Se comprueba en valor absoluto para rechazar también los timestamps del
   * futuro: un reloj adelantado alargaría la ventana sin que se note.
   */
  const segundosAhora = Math.floor(ahora / 1000);
  const desfase = Math.abs(segundosAhora - Number(timestamp));
  if (desfase > VENTANA_ANTIRREPLAY_SEGUNDOS) {
    return { valida: false, motivo: "fuera_de_ventana" };
  }

  const esperada = createHmac("sha256", secreto)
    .update(`${timestamp}.${cuerpoCrudo}`)
    .digest("hex");

  /*
   * Si el largo no es el de una firma SHA-256, no coincide y punto. Salir aquí
   * no filtra nada útil: el largo de una firma es público y siempre el mismo,
   * así que saberlo no acerca a nadie a adivinar su contenido.
   *
   * Esto evita el baile de rellenar buffers para igualar largos que hace falta
   * si se comparan cadenas de tamaño distinto.
   */
  if (recibida.length !== LARGO_FIRMA_HEX || esperada.length !== LARGO_FIRMA_HEX) {
    return { valida: false, motivo: "no_coincide" };
  }

  /*
   * Comparación en tiempo constante. Con `===` el tiempo de respuesta depende
   * de cuántos caracteres coinciden antes de fallar, y midiendo esa diferencia
   * se puede deducir la firma carácter a carácter. `timingSafeEqual` tarda lo
   * mismo acierte o falle.
   */
  const coincide = timingSafeEqual(
    Buffer.from(esperada, "hex"),
    Buffer.from(recibida, "hex"),
  );

  return coincide ? { valida: true } : { valida: false, motivo: "no_coincide" };
}
