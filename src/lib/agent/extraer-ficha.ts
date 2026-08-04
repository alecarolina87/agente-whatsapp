import "server-only";

import { completarChat } from "@/lib/openrouter/client";

/**
 * De la web de un cliente a su ficha, con ayuda del modelo.
 *
 * ## Lo que devuelve es una propuesta, no un guardado
 *
 * Nada de esto se escribe en la base de datos: se le enseña a quien está dando
 * de alta el negocio para que lo revise. Un modelo leyendo una web se inventa
 * un precio de vez en cuando, y un precio inventado en el agente de una clínica
 * es un problema de verdad — de los que acaban en una reclamación.
 *
 * Por eso el flujo es: leer → proponer → **que una persona lo mire** → guardar.
 */

const INSTRUCCIONES = `Te paso el texto de la web de un negocio. Extrae su información para configurar un asistente que atenderá su WhatsApp.

Devuelve SOLO un objeto JSON, sin texto alrededor y sin markdown, con esta forma exacta:

{
  "texto_libre": "dos o tres frases sobre qué es el negocio y cómo trabaja",
  "servicios": [{ "nombre": "", "descripcion": "", "precio": "", "duracion": "" }],
  "horarios": "",
  "direccion": "",
  "zona": "",
  "faqs": [{ "pregunta": "", "respuesta": "" }],
  "objeciones": [{ "objecion": "", "respuesta": "" }]
}

Reglas:
- Usa SOLO lo que diga el texto. Si un dato no aparece, deja el campo vacío o la lista vacía. NO inventes precios, horarios ni direcciones: es el error más grave que puedes cometer aquí.
- Los precios, cópialos tal cual aparecen ("desde 60 €", "consultar").
- En "objeciones" pon las dudas que frenan a un cliente —que es caro, que duele, que está lejos— solo si la web las trata. Si no dice nada, deja la lista vacía.
- Escribe en el mismo idioma que la web.
- Máximo 12 servicios y 8 preguntas: quédate con lo que más se pregunta.`;

export type FichaPropuesta = {
  texto_libre: string;
  servicios: { nombre: string; descripcion: string; precio: string; duracion: string }[];
  horarios: string;
  direccion: string;
  zona: string;
  faqs: { pregunta: string; respuesta: string }[];
  objeciones: { objecion: string; respuesta: string }[];
};

export type ResultadoExtraccion =
  | { ok: true; ficha: FichaPropuesta; costeUsd: number }
  | { ok: false; motivo: string };

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Da forma a lo que devuelva el modelo.
 *
 * No se confía en que respete el esquema aunque se le pida: un campo de más se
 * ignora y uno que falte queda vacío. Sin esto, un JSON con `servicios` como
 * cadena en vez de lista rompería la pantalla al pintarla.
 */
function normalizar(crudo: unknown): FichaPropuesta {
  const o = (crudo ?? {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v : []);

  return {
    texto_libre: texto(o.texto_libre),
    horarios: texto(o.horarios),
    direccion: texto(o.direccion),
    zona: texto(o.zona),
    servicios: lista(o.servicios)
      .map((s) => {
        const x = (s ?? {}) as Record<string, unknown>;
        return {
          nombre: texto(x.nombre),
          descripcion: texto(x.descripcion),
          precio: texto(x.precio),
          duracion: texto(x.duracion),
        };
      })
      .filter((s) => s.nombre)
      .slice(0, 12),
    faqs: lista(o.faqs)
      .map((f) => {
        const x = (f ?? {}) as Record<string, unknown>;
        return { pregunta: texto(x.pregunta), respuesta: texto(x.respuesta) };
      })
      .filter((f) => f.pregunta && f.respuesta)
      .slice(0, 8),
    objeciones: lista(o.objeciones)
      .map((ob) => {
        const x = (ob ?? {}) as Record<string, unknown>;
        return { objecion: texto(x.objecion), respuesta: texto(x.respuesta) };
      })
      .filter((ob) => ob.objecion && ob.respuesta)
      .slice(0, 8),
  };
}

/** Saca el JSON aunque venga envuelto en explicaciones o en un bloque de código. */
function extraerJson(salida: string): unknown | null {
  const limpio = salida
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(limpio);
  } catch {
    // Segundo intento: quedarse con lo que hay entre la primera llave y la
    // última. Los modelos a veces añaden «Aquí tienes:» delante.
    const desde = limpio.indexOf("{");
    const hasta = limpio.lastIndexOf("}");
    if (desde === -1 || hasta <= desde) return null;

    try {
      return JSON.parse(limpio.slice(desde, hasta + 1));
    } catch {
      return null;
    }
  }
}

export async function extraerFicha(textoWeb: string): Promise<ResultadoExtraccion> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelo = process.env.OPENROUTER_DEFAULT_MODEL;
  if (!apiKey || !modelo) return { ok: false, motivo: "Falta la configuración del modelo." };

  let respuesta;
  try {
    respuesta = await completarChat({
      apiKey,
      modelo,
      mensajes: [
        { role: "system", content: INSTRUCCIONES },
        { role: "user", content: textoWeb },
      ],
      // La ficha entera es larga: con el tope normal de respuesta se cortaría
      // a la mitad y el JSON no se podría leer.
      maxTokens: 3000,
    });
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    return { ok: false, motivo: `El modelo no pudo leer la web: ${motivo}` };
  }

  const crudo = extraerJson(respuesta.texto);
  if (!crudo) {
    return { ok: false, motivo: "No se entendió lo que devolvió el modelo. Prueba otra vez." };
  }

  return {
    ok: true,
    ficha: normalizar(crudo),
    costeUsd: respuesta.uso.costeUsd ?? 0,
  };
}
