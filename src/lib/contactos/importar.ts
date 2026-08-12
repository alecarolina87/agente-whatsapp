import { normalizarE164 } from "@/lib/ycloud/normalize";

/**
 * Lee una lista de contactos pegada a mano.
 *
 * ## Por qué pegar y no subir un archivo
 *
 * Porque es lo que la gente tiene. Una clínica no exporta un CSV limpio: copia
 * una columna de Excel, o pega lo que le mandó la recepcionista por correo. Un
 * cargador de archivos obligaría a convertir antes, y ahí es donde se abandona.
 *
 * ## Qué acepta
 *
 * Una línea por persona, con el teléfono primero y el nombre después. Sirven la
 * coma, el punto y coma y el tabulador —que es lo que sale al copiar de Excel—
 * y también una lista de teléfonos a secas.
 *
 *     +34 600 00 00 00, María
 *     34600000001;Lucía Pérez
 *     600000002	Ana
 *     600000003
 *
 * ## Lo que NO hace
 *
 * No inventa consentimiento. Esta función solo lee texto; quién dio permiso
 * para recibir mensajes lo declara quien importa, y va aparte.
 */

export type FilaImportada = {
  telefono: string;
  nombre: string | null;
};

export type Descartada = {
  linea: number;
  texto: string;
  motivo: string;
};

export type ResultadoLectura = {
  validas: FilaImportada[];
  descartadas: Descartada[];
  /** Cuántas venían repetidas dentro del propio texto pegado. */
  repetidas: number;
};

/** Coma, punto y coma o tabulador. El tabulador es lo que da Excel al copiar. */
const SEPARADOR = /[,;\t]/;

export function leerLista(texto: string): ResultadoLectura {
  const validas: FilaImportada[] = [];
  const descartadas: Descartada[] = [];
  const vistos = new Set<string>();
  let repetidas = 0;

  const lineas = texto.split(/\r?\n/);

  for (const [indice, cruda] of lineas.entries()) {
    const linea = cruda.trim();
    const numeroDeLinea = indice + 1;

    // Las líneas en blanco no son un error: se cuelan al copiar y pegar.
    if (!linea) continue;

    const partes = linea.split(SEPARADOR).map((p) => p.trim());
    const telefonoCrudo = partes[0] ?? "";
    const nombre = partes.slice(1).join(" ").trim();

    /*
     * Una cabecera de Excel («teléfono, nombre») se cuela en la primera línea
     * casi siempre. Se descarta como cualquier otra línea sin número válido, y
     * el motivo lo explica: así quien pega ve que se ignoró y por qué, en vez
     * de contar uno de menos y no saber cuál.
     */
    const telefono = normalizarE164(telefonoCrudo);

    if (!telefono) {
      descartadas.push({
        linea: numeroDeLinea,
        texto: linea.slice(0, 60),
        motivo: telefonoCrudo
          ? "no parece un teléfono"
          : "la línea no empieza por un teléfono",
      });
      continue;
    }

    /*
     * Repetidos dentro del propio texto. Se quedan con el primero y no se
     * cuentan como error: pegar una lista con duplicados es normalísimo, y
     * llamarlo «fallo» haría dudar de la importación entera.
     */
    if (vistos.has(telefono)) {
      repetidas += 1;
      continue;
    }

    vistos.add(telefono);
    validas.push({ telefono, nombre: nombre || null });
  }

  return { validas, descartadas, repetidas };
}
