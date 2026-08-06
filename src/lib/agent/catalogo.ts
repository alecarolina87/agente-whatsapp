/**
 * Los modelos que se pueden elegir para un negocio.
 *
 * ## Por qué está separado de `modelos.ts`
 *
 * Esta lista la necesitan las dos orillas: el servidor, para validar lo que
 * llega del formulario, y el navegador, para pintar el desplegable. `modelos.ts`
 * no vale porque arrastra el cliente de OpenRouter, que es `server-only` y
 * rompería la compilación del navegador — con la clave de la API dentro, que es
 * exactamente lo que ese marcador impide.
 *
 * ## Por qué no hay precios en dólares
 *
 * Porque caducan. Es la misma razón por la que el coste de cada respuesta se
 * guarda tal y como lo devuelve OpenRouter en lugar de calcularlo con una tabla
 * propia: una tabla de precios vieja da cifras que parecen ciertas. Aquí va el
 * coste **relativo**, que aguanta mucho mejor, y el gasto de verdad se ve en la
 * pantalla del negocio, sumado de lo que cobró el proveedor.
 */

export type Modelo = {
  /** El identificador exacto de OpenRouter. */
  id: string;
  nombre: string;
  /** Para qué sirve, en términos del negocio y no del modelo. */
  descripcion: string;
  /** Cuánto cuesta comparado con el más barato de la lista. */
  coste: string;
};

/**
 * De más barato a más capaz.
 *
 * Lista corta a propósito. Un desplegable con cuarenta modelos no es más
 * libertad: es una decisión que nadie sabe tomar, y acaba con todo el mundo
 * dejando el primero.
 *
 * Los tres son de Anthropic porque son los que ya están probados con
 * `data_collection: "deny"`, la opción que impide que el proveedor guarde las
 * conversaciones para entrenar. Meter un modelo más barato de otro proveedor
 * sin comprobar eso antes sería cambiar el precio por la promesa que se le hace
 * a una clínica sobre los datos de sus pacientes.
 */
export const MODELOS: Modelo[] = [
  {
    id: "anthropic/claude-haiku-4.5",
    nombre: "Rápido",
    descripcion:
      "Contesta en un par de segundos y basta para lo habitual: horarios, precios, pedir cita.",
    coste: "el más barato",
  },
  {
    id: "anthropic/claude-sonnet-5",
    nombre: "Equilibrado",
    descripcion:
      "Escribe bastante mejor y se pierde menos en conversaciones largas o con preguntas encadenadas.",
    coste: "unas 2 veces el rápido",
  },
  {
    id: "anthropic/claude-opus-5",
    nombre: "El más capaz",
    descripcion:
      "Para negocios donde una respuesta floja cuesta un cliente. Es notablemente más caro.",
    coste: "unas 5 veces el rápido",
  },
];

/** `true` si ese identificador sigue estando en el catálogo. */
export function modeloValido(id: string | null | undefined): boolean {
  return Boolean(id) && MODELOS.some((m) => m.id === id);
}
