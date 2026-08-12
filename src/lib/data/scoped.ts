import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Capa de datos con `workspace_id` obligatorio (§7 del BLUEPRINT).
 *
 * ## Por qué existe
 *
 * RLS protege al cliente, pero el código de servidor usa la clave de servicio y
 * **se salta RLS**. El webhook, el motor del agente y las tareas programadas no
 * tienen sesión de usuario, así que ahí no hay nada que filtre por workspace.
 *
 * Si el servidor pudiera escribir `from("messages").select("*")` a secas,
 * bastaría un descuido para devolver los mensajes de todos los clientes.
 *
 * ## Cómo lo evita
 *
 * No confiando en que nadie se acuerde. `scoped()` devuelve un objeto donde
 * `select`, `update` y `delete` **ya llevan el filtro puesto**, e `insert`
 * inyecta el `workspace_id` en cada fila. No hay forma de pedir una consulta
 * sin scope: la firma no lo permite.
 *
 * Para lo que quede fuera de este molde (agregados, joins raros) existe
 * `raw()`, que obliga a escribir una justificación. Es deliberadamente
 * incómodo: si aparece mucho en el código, es señal de que algo hay que
 * replantear.
 *
 * @example
 * const db = scoped(workspaceId);
 * const { data } = await db.from("conversations").select("*").limit(20);
 */

/** Tablas que llevan workspace_id. Fuera de esta lista no se pasa. */
const TABLAS_CON_WORKSPACE = [
  "workspaces",
  "workspace_members",
  "channels",
  "integrations",
  "contacts",
  "conversations",
  "messages",
  "message_batches",
  "processed_events",
  "events",
  "business_info",
  "templates",
] as const;

export type TablaConWorkspace = (typeof TABLAS_CON_WORKSPACE)[number];

/**
 * El workspace tiene que ser un uuid de verdad.
 *
 * Sin esta comprobación, un `undefined` que llegue como cadena vacía produciría
 * un filtro que no filtra nada y el aislamiento se caería en silencio, que es
 * la peor forma de fallar.
 */
const esquemaWorkspaceId = z.uuid({
  message: "workspace_id debe ser un uuid válido",
});

export function scoped(workspaceId: string) {
  const ws = esquemaWorkspaceId.parse(workspaceId);
  const db = createAdminClient();

  return {
    workspaceId: ws,

    from(tabla: TablaConWorkspace) {
      // `workspaces` se identifica por su propio id, no por una columna
      // workspace_id. Es la única excepción y va contemplada aquí, no en cada
      // sitio donde se use.
      const columna = tabla === "workspaces" ? "id" : "workspace_id";

      return {
        /**
         * SELECT con el workspace ya filtrado.
         *
         * `opciones` existe para `{ count: "exact", head: true }`, que es como
         * se cuentan filas sin traérselas.
         *
         * ## Sobre los tipos
         *
         * El proyecto no genera los tipos del esquema de Supabase, así que el
         * cliente no sabe qué columnas tiene cada tabla y devuelve un tipo
         * inservible. La forma esperada se declara **al final de la cadena**
         * con `.overrideTypes<Fila[], { merge: false }>()`, porque ese método
         * cierra la consulta y no deja seguir encadenando `.eq()` ni `.limit()`.
         *
         * No es una comprobación real contra la base de datos —eso lo darían
         * los tipos generados, pendientes— pero hace que un cambio de nombre de
         * columna salte donde se usa.
         */
        select(
          columnas = "*",
          opciones?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
        ) {
          return db.from(tabla).select(columnas, opciones).eq(columna, ws);
        },

        /** INSERT con el workspace_id inyectado en cada fila. */
        insert<T extends Record<string, unknown>>(filas: T | T[]) {
          const conScope = (Array.isArray(filas) ? filas : [filas]).map((f) => ({
            ...f,
            ...(tabla === "workspaces" ? {} : { workspace_id: ws }),
          }));
          return db.from(tabla).insert(conScope).select();
        },

        /**
         * UPSERT con el workspace_id inyectado, igual que `insert`.
         *
         * Existe porque el webhook lo necesita: cada mensaje entrante trae un
         * contacto que puede ser nuevo o no, y resolverlo con "consulta y si no
         * existe inserta" abre una carrera — dos mensajes seguidos de la misma
         * persona pasarían los dos la comprobación y chocarían contra
         * `unique (workspace_id, wa_phone)`.
         *
         * `onConflict` tiene que nombrar las columnas del índice único, no
         * incluye `workspace_id` automáticamente: quien llama lo pasa entero.
         */
        upsert<T extends Record<string, unknown>>(
          filas: T | T[],
          opciones: { onConflict: string; ignoreDuplicates?: boolean },
        ) {
          const conScope = (Array.isArray(filas) ? filas : [filas]).map((f) => ({
            ...f,
            ...(tabla === "workspaces" ? {} : { workspace_id: ws }),
          }));
          return db.from(tabla).upsert(conScope, opciones).select();
        },

        /** UPDATE limitado al workspace. */
        update(cambios: Record<string, unknown>) {
          // Nadie mueve una fila de un workspace a otro por accidente.
          const { workspace_id: _descartado, ...limpio } = cambios;
          return db.from(tabla).update(limpio).eq(columna, ws);
        },

        /** DELETE limitado al workspace. */
        delete() {
          return db.from(tabla).delete().eq(columna, ws);
        },
      };
    },

    /**
     * Escotilla de escape para lo que no encaje en el molde.
     *
     * Devuelve el cliente sin scope, así que **el filtro es responsabilidad de
     * quien la llama**. El motivo es obligatorio y aparece en los logs: sirve
     * para que en una revisión se vea de un vistazo cada sitio donde se pisó
     * la protección, y por qué.
     */
    raw(motivo: string) {
      if (!motivo?.trim()) {
        throw new Error("raw() requiere un motivo que justifique saltarse el scope.");
      }
      console.warn(`[scoped.raw] workspace=${ws} motivo="${motivo}"`);
      return db;
    },
  };
}

export type ClienteConScope = ReturnType<typeof scoped>;
