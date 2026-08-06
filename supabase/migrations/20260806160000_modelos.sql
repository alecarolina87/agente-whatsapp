-- ============================================================================
-- Qué modelo usa cada negocio, y con cuál sigue si ese falla
--
-- POR QUÉ HACE FALTA
--
-- Hasta ahora todos los clientes compartían el modelo de la plataforma, fijado
-- en una variable de entorno. Eso tiene dos problemas distintos:
--
--   1. NO SE PUEDE COBRAR DISTINTO. Una clínica que contesta dudas de
--      ortodoncia y un negocio que solo confirma citas no necesitan la misma
--      inteligencia, pero hoy pagan lo mismo porque cuestan lo mismo. Con el
--      modelo por negocio, la diferencia entre un plan y otro deja de ser una
--      promesa y pasa a ser una fila en la base de datos.
--
--   2. UN MAL DÍA DEL PROVEEDOR DEJA MUDOS A TODOS. Si el modelo da error, el
--      agente se calla y la clienta se queda sin respuesta. Nadie se entera
--      hasta que llama. El respaldo es lo que convierte «hoy no contesta» en
--      «hoy contesta un poco distinto», que no se nota.
--
-- De las dos, el respaldo es la que de verdad importa: la primera es una
-- oportunidad, la segunda es una avería.
--
-- POR QUÉ NULL Y NO UN VALOR POR DEFECTO
--
-- `null` significa «lo que diga la plataforma», no «ninguno». Así, el día que
-- cambie el modelo por defecto de la agencia, cambia para todos los clientes
-- que no hayan elegido a mano — que es lo que se quiere. Con un default
-- copiado en cada fila, cada negocio se quedaría congelado en el modelo que
-- había el día que se dio de alta.
-- ============================================================================

alter table workspaces
  -- El modelo con el que contesta este negocio, tal y como lo llama OpenRouter
  -- (p. ej. `anthropic/claude-haiku-4.5`). `null` = el de la plataforma.
  add column if not exists modelo text,

  -- Con cuál se reintenta si el principal falla. `null` = no reintentar.
  add column if not exists modelo_respaldo text;

comment on column workspaces.modelo is
  'Modelo de OpenRouter con el que responde este negocio. null = el de la plataforma (OPENROUTER_DEFAULT_MODEL).';
comment on column workspaces.modelo_respaldo is
  'Modelo con el que se reintenta si el principal falla. null = no se reintenta.';

-- ── Por qué no hay una tabla de modelos ─────────────────────────────────────
--
-- La tentación es crear `modelos` con nombre, precio y descripción, y una
-- clave foránea desde aquí. No se hace, y por la misma razón que el coste de
-- cada respuesta se guarda tal y como lo devuelve OpenRouter en vez de
-- calcularlo con una tabla propia: **los precios y el catálogo cambian solos**,
-- y una tabla que hay que mantener a mano acaba mintiendo.
--
-- El catálogo vive en el código (`src/lib/agent/modelos.ts`), donde se revisa
-- en cada despliegue, y aquí solo queda el identificador. Si un modelo
-- desaparece del catálogo, el negocio que lo tuviera vuelve al de la
-- plataforma en vez de romperse.
