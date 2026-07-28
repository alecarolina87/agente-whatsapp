-- ============================================================================
-- F0 · Row Level Security
-- Implementa el §7 del BLUEPRINT: deny-by-default en todas las tablas de
-- negocio; una fila es visible si su workspace_id pertenece a un
-- workspace_members del auth.uid() actual.
--
-- Helpers is_member() / has_role() tal y como los especifica el blueprint.
-- ============================================================================

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER a propósito, y no es un descuido: sin él, la política de
-- workspace_members llamaría a is_member(), que consulta workspace_members,
-- que vuelve a evaluar la política... recursión infinita. Al ser definer, la
-- función lee la tabla saltándose RLS y se corta el bucle.
--
-- search_path vacío y nombres cualificados: si no se fija, alguien puede crear
-- un esquema propio y secuestrar la resolución de nombres dentro de una función
-- que corre con permisos elevados.

create or replace function public.is_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_role(target_workspace uuid, allowed public.role_enum[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
      and m.role = any(allowed)
  );
$$;

comment on function public.is_member is
  'True si el usuario actual pertenece al workspace. Base de todas las políticas RLS.';
comment on function public.has_role is
  'True si el usuario actual pertenece al workspace con alguno de los roles dados.';

-- ── Activar RLS ─────────────────────────────────────────────────────────────
-- Sin políticas, activar RLS deja la tabla cerrada a cal y canto. Eso es lo que
-- queremos de partida: deny-by-default. Lo que se abre, se abre a mano.

alter table workspaces        enable row level security;
alter table workspace_members enable row level security;
alter table channels          enable row level security;
alter table integrations      enable row level security;
alter table contacts          enable row level security;
alter table conversations     enable row level security;
alter table messages          enable row level security;
alter table processed_events  enable row level security;
alter table events            enable row level security;

-- ── workspaces ──────────────────────────────────────────────────────────────
-- Ves tu workspace si eres miembro. Solo un admin puede renombrarlo o borrarlo.

create policy "miembros ven su workspace"
  on workspaces for select
  to authenticated
  using (public.is_member(id));

create policy "admin edita el workspace"
  on workspaces for update
  to authenticated
  using (public.has_role(id, array['admin']::role_enum[]))
  with check (public.has_role(id, array['admin']::role_enum[]));

create policy "admin borra el workspace"
  on workspaces for delete
  to authenticated
  using (public.has_role(id, array['admin']::role_enum[]));

-- Crear workspaces se hace desde servidor (alta con su primer admin en una
-- transacción), así que aquí no hay política de insert: queda denegado.

-- ── workspace_members ───────────────────────────────────────────────────────

create policy "miembros ven el equipo"
  on workspace_members for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "admin gestiona el equipo"
  on workspace_members for all
  to authenticated
  using (public.has_role(workspace_id, array['admin']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin']::role_enum[]));

-- ── channels e integrations ─────────────────────────────────────────────────
-- Los ve cualquier miembro; solo admin y manager los tocan, porque de ahí
-- cuelgan las credenciales (por referencia) y el system_prompt.

create policy "miembros ven los canales"
  on channels for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "admin y manager gestionan los canales"
  on channels for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]));

create policy "miembros ven las integraciones"
  on integrations for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "admin y manager gestionan las integraciones"
  on integrations for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]));

-- ── contacts, conversations, messages ───────────────────────────────────────
-- El trabajo diario del inbox. Cualquier miembro salvo viewer, que solo mira.

create policy "miembros ven los contactos"
  on contacts for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "el equipo gestiona los contactos"
  on contacts for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager', 'agent']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager', 'agent']::role_enum[]));

create policy "miembros ven las conversaciones"
  on conversations for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "el equipo gestiona las conversaciones"
  on conversations for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager', 'agent']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager', 'agent']::role_enum[]));

create policy "miembros leen los mensajes"
  on messages for select
  to authenticated
  using (public.is_member(workspace_id));

-- Insertar mensajes de salida desde la interfaz. El webhook entra por
-- service-role, que se salta RLS.
create policy "el equipo escribe mensajes"
  on messages for insert
  to authenticated
  with check (public.has_role(workspace_id, array['admin', 'manager', 'agent']::role_enum[]));

-- Los mensajes no se editan ni se borran desde el cliente: son el registro de
-- lo que pasó. Sin políticas de update/delete, queda prohibido.

-- ── processed_events y events ───────────────────────────────────────────────
-- processed_events es fontanería de idempotencia: nadie la lee desde la app.
-- Sin ninguna política, queda cerrada a los clientes y solo la toca el
-- service-role.

-- events es el log de decisión. Se puede leer para depurar, pero escribirlo
-- desde el cliente falsearía el registro: solo el service-role escribe (§6.1).
create policy "miembros leen los eventos"
  on events for select
  to authenticated
  using (public.is_member(workspace_id));
