/**
 * La información del negocio, convertida en contexto para el modelo.
 *
 * Va aparte del `system_prompt` porque son cosas distintas: el prompt dice
 * **cómo** habla el agente, y esto dice **qué sabe**. Mezclarlos obliga a
 * releer un muro de texto cada vez que cambia un precio, y a nadie le queda
 * claro qué puede tocar sin estropear el tono.
 *
 * Función pura y sin base de datos: se puede probar sola.
 */

export type Servicio = {
  nombre?: string;
  descripcion?: string;
  precio?: string;
  duracion?: string;
};

export type Faq = { pregunta?: string; respuesta?: string };
export type Objecion = { objecion?: string; respuesta?: string };

export type InfoNegocio = {
  /** Lo que sea, contado a mano. Va lo primero. */
  texto_libre?: string | null;
  descripcion?: string | null;
  servicios?: Servicio[] | null;
  horarios?: string | null;
  direccion?: string | null;
  zona?: string | null;
  faqs?: Faq[] | null;
  objeciones?: Objecion[] | null;
  no_prometer?: string | null;
  web?: string | null;
};

const vacio = (v?: string | null) => !v || !v.trim();

/**
 * Convierte la ficha en texto para el prompt.
 *
 * Devuelve `null` si no hay nada que contar. Es importante: un bloque con
 * epígrafes vacíos —«SERVICIOS:» seguido de nada— le dice al modelo que ese
 * negocio no tiene servicios, y a partir de ahí contesta que no ofrece nada.
 * Peor que no poner el bloque.
 */
export function describirNegocio(info: InfoNegocio | null | undefined): string | null {
  if (!info) return null;

  const partes: string[] = [];

  /*
   * El texto libre va primero y sin epígrafe.
   *
   * Es lo que escribe quien conoce el negocio, con sus palabras, y suele
   * llevar el contexto que ninguna casilla recoge. Encabezarlo lo convertiría
   * en «una sección más»; así se lee como lo que es: la explicación.
   */
  if (!vacio(info.texto_libre)) partes.push(info.texto_libre!.trim());

  if (!vacio(info.descripcion)) partes.push(`EL NEGOCIO:\n${info.descripcion!.trim()}`);

  const servicios = (info.servicios ?? []).filter((s) => !vacio(s.nombre));
  if (servicios.length > 0) {
    partes.push(
      "SERVICIOS:\n" +
        servicios
          .map((s) => {
            // En una línea por servicio: el modelo lo lee mejor y ocupa menos
            // tokens, que se pagan en cada respuesta.
            const detalles = [s.descripcion, s.precio, s.duracion].filter((d) => !vacio(d));
            return `- ${s.nombre!.trim()}${detalles.length ? ` — ${detalles.join(" · ")}` : ""}`;
          })
          .join("\n"),
    );
  }

  const donde = [info.direccion, info.zona].filter((d) => !vacio(d)).join(" · ");
  if (donde) partes.push(`DÓNDE:\n${donde}`);
  if (!vacio(info.horarios)) partes.push(`HORARIOS:\n${info.horarios!.trim()}`);

  const faqs = (info.faqs ?? []).filter((f) => !vacio(f.pregunta) && !vacio(f.respuesta));
  if (faqs.length > 0) {
    partes.push(
      "PREGUNTAS FRECUENTES:\n" +
        faqs.map((f) => `- ${f.pregunta!.trim()}\n  ${f.respuesta!.trim()}`).join("\n"),
    );
  }

  const objeciones = (info.objeciones ?? []).filter(
    (o) => !vacio(o.objecion) && !vacio(o.respuesta),
  );
  if (objeciones.length > 0) {
    /*
     * Se le dice al modelo qué son, no solo cuáles son. Sin esa frase las trata
     * como más preguntas frecuentes y las suelta sin venir a cuento; con ella
     * espera a que aparezca la duda.
     */
    partes.push(
      "SI TE PONEN ALGUNA DE ESTAS PEGAS, RESPONDE ASÍ:\n" +
        objeciones.map((o) => `- «${o.objecion!.trim()}» → ${o.respuesta!.trim()}`).join("\n"),
    );
  }

  if (!vacio(info.web)) partes.push(`WEB:\n${info.web!.trim()}`);

  /*
   * Lo prohibido va al final de todo, y con mayúsculas.
   *
   * Lo último que lee el modelo pesa más. Y en los negocios de aquí —clínicas,
   * estética— una promesa de más no es un problema de marketing: es una
   * afirmación sanitaria que nadie ha supervisado.
   */
  if (!vacio(info.no_prometer)) {
    partes.push(`NO PROMETAS NUNCA, PASE LO QUE PASE:\n${info.no_prometer!.trim()}`);
  }

  return partes.length > 0 ? partes.join("\n\n") : null;
}
