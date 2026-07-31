-- ============================================================================
-- F2 · Buffer de silencio
--
-- EL PROBLEMA
--
-- La gente no escribe párrafos por WhatsApp: escribe "hola", "oye", "una
-- pregunta" en diez segundos. Sin buffer, el agente contesta tres veces —tres
-- llamadas al modelo, tres mensajes al cliente— y la conversación queda absurda.
--
-- LA SOLUCIÓN
--
-- Cada mensaje entrante entra en un lote abierto y empuja hacia adelante el
-- momento de contestar. Cuando pasan N segundos sin que llegue nada más, se
-- responde una sola vez con todo el contexto.
--
-- EL ÍNDICE ÚNICO PARCIAL ES LA PIEZA CLAVE
--
--   unique (conversation_id) where status = 'open'
--
-- Garantiza **un solo lote abierto por conversación**, y lo garantiza Postgres,
-- no el código. Sin él, dos mensajes que llegan a la vez crearían dos lotes y
-- el agente volvería a contestar dos veces: justo lo que este trabajo viene a
-- arreglar. Es la misma idea que el dedupe del webhook — dejar que falle un
-- índice en vez de consultar y confiar.
-- ============================================================================

create type batch_status_enum as enum ('open', 'flushing', 'done', 'failed');

create table message_batches (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  status          batch_status_enum not null default 'open',

  -- Cuándo toca contestar. Cada mensaje nuevo lo empuja hacia adelante.
  flush_at        timestamptz not null,

  -- Para no reintentar sin fin un lote que falla siempre.
  intentos        integer not null default 0,
  ultimo_error    text,

  created_at      timestamptz not null default now(),
  flushed_at      timestamptz
);

-- Un solo lote abierto por conversación. Lo hace cumplir la base de datos.
create unique index message_batches_abierto_key
  on message_batches (conversation_id)
  where status = 'open';

-- El barrido busca lotes vencidos: este índice es el que lo hace barato.
create index message_batches_pendientes_idx
  on message_batches (flush_at)
  where status = 'open';

create index message_batches_workspace_idx on message_batches (workspace_id, created_at desc);

-- `messages.batch_id` existía desde F0 esperando esta tabla.
alter table messages
  add constraint messages_batch_fk
  foreign key (batch_id) references message_batches (id) on delete set null;

-- ── Segundos de silencio, por cliente ───────────────────────────────────────
-- Es un ajuste y no una constante porque depende del negocio: una clínica que
-- atiende urgencias quiere responder rápido; una tienda puede esperar más y
-- agrupar mejor. Treinta segundos es el punto medio razonable.
alter table workspaces
  add column if not exists buffer_segundos integer not null default 30,
  -- Cuántos mensajes recuerda la IA al responder. Estaba fijo en el código, y
  -- cada mensaje de contexto se paga en cada llamada: tiene que ser ajustable.
  add column if not exists mensajes_de_contexto integer not null default 20;

comment on column workspaces.buffer_segundos is
  'Silencio que espera el agente tras el último mensaje antes de responder.';
comment on column workspaces.mensajes_de_contexto is
  'Cuántos mensajes recientes se le pasan al modelo en cada respuesta.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table message_batches enable row level security;

-- Solo lectura para el equipo: los lotes los crea y los cierra el servidor.
-- Que alguien pudiera marcarlos a mano abriría la puerta a responder dos veces.
create policy "miembros ven los lotes"
  on message_batches for select
  to authenticated
  using (public.is_member(workspace_id));

grant select on message_batches to authenticated;
grant all on message_batches to service_role;
