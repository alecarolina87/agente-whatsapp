-- ============================================================================
-- F2 · Realtime en el inbox
--
-- Supabase no emite cambios de cualquier tabla: hay que apuntarla a la
-- publicación `supabase_realtime`. Sin esto, la suscripción del navegador se
-- conecta bien, no da ningún error, y no llega nunca nada — que es la forma más
-- desesperante de fallar.
--
-- SOBRE LA SEGURIDAD
--
-- Realtime respeta RLS: a cada navegador solo le llegan las filas que sus
-- políticas le dejarían leer. Como `messages` y `conversations` ya están
-- protegidas por pertenencia al workspace (migración de RLS de F0), esto no
-- abre nada nuevo: emite lo mismo que ya se podía consultar.
--
-- Se apuntan solo estas dos tablas. `events` queda fuera a propósito: es el log
-- de decisiones internas, con motivos de rechazo de firma y detalles de coste,
-- y no tiene por qué viajar a ningún navegador.
-- ============================================================================

do $$
begin
  -- `add table` falla si la tabla ya está en la publicación, y esta migración
  -- tiene que poder ejecutarse dos veces sin romperse.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

-- Para que un UPDATE llegue con los valores anteriores además de los nuevos.
-- Sin esto, al cambiar `ai_enabled` el aviso viaja solo con la clave primaria y
-- el cliente no puede saber qué cambió sin volver a consultar.
alter table public.conversations replica identity full;
