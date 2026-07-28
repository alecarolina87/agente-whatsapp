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
  "processed_events",
  "events",
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
        /** SELECT con el workspace ya filtrado. */
        select(columnas = "*") {
          return db.from(tabla).select(columnas).eq(columna, ws);
        },

        /** INSERT con el workspace_id inyectado en cada fila. */
        insert<T extends Record<string, unknown>>(filas: T | T[]) {
          const conScope = (Array.isArray(filas) ? filas : [filas]).map((f) => ({
            ...f,
            ...(tabla === "workspaces" ? {} : { workspace_id: ws }),
          }));
          return db.from(tabla).insert(conScope).select();
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
