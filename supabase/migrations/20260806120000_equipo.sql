-- ═══════════════════════════════════════════════════════════════════════════
-- El equipo de un negocio
--
-- `workspace_members` y los cuatro roles existen desde F0, y el RLS cuelga de
-- ellos. Lo que nunca se construyó es la forma de meter a alguien: hasta hoy,
-- el único miembro de un workspace era quien lo creaba.
--
-- Eso deja fuera al cliente. Una clínica no puede ver sus propias
-- conversaciones, y toda la arquitectura multi-tenant se queda sin usar.
--
-- ## Por qué sin correos de invitación
--
-- Lo normal sería mandar un email con un enlace. Eso obliga a configurar un
-- servidor de correo, a que el correo no acabe en spam, y a que el cliente lo
-- encuentre. Tres cosas que fallan.
--
-- Aquí se crea la cuenta en el momento con una contraseña, y quien da de alta
-- se la pasa al cliente por donde ya está hablando con él. Cero infraestructura
-- y cero correos perdidos. Idea tomada del panel del curso, que lo resuelve
-- así.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Añade a alguien que YA tiene cuenta, o le cambia el rol.
 *
 * La cuenta se crea desde el servidor con la API de administración de Supabase
 * —no se puede desde SQL— y después se llama aquí para darle acceso.
 */
create or replace function public.agregar_al_equipo(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_rol          role_enum default 'agent'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * La función se salta RLS, así que comprueba ella misma que quien llama sea
   * admin de ese negocio. Sin esto, cualquiera con sesión podría darse acceso
   * al workspace de otro pasando su identificador.
   */
  if not public.has_role(p_workspace_id, array['admin']::role_enum[]) then
    raise exception 'solo un admin puede gestionar el equipo de este negocio';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_user_id, p_rol)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  insert into public.events (workspace_id, type, actor, payload)
  values (p_workspace_id, 'team.member_added', 'human',
          jsonb_build_object('user_id', p_user_id, 'rol', p_rol));
end;
$$;

/**
 * Saca a alguien del equipo.
 *
 * No deja quitar al último admin: un negocio sin nadie que pueda gestionarlo
 * queda huérfano y solo se arregla entrando a la base de datos a mano.
 */
create or replace function public.quitar_del_equipo(
  p_workspace_id uuid,
  p_user_id      uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admins int;
  v_era_admin boolean;
begin
  if not public.has_role(p_workspace_id, array['admin']::role_enum[]) then
    raise exception 'solo un admin puede gestionar el equipo de este negocio';
  end if;

  select role = 'admin' into v_era_admin
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id;

  if v_era_admin is null then
    raise exception 'esa persona no está en el equipo';
  end if;

  select count(*) into v_admins
    from public.workspace_members
   where workspace_id = p_workspace_id and role = 'admin';

  if v_era_admin and v_admins <= 1 then
    raise exception 'no puedes quitar al único admin: el negocio se quedaría sin nadie que lo gestione';
  end if;

  delete from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id;

  insert into public.events (workspace_id, type, actor, payload)
  values (p_workspace_id, 'team.member_removed', 'human',
          jsonb_build_object('user_id', p_user_id));
end;
$$;

revoke all on function public.agregar_al_equipo(uuid, uuid, role_enum) from public, anon;
revoke all on function public.quitar_del_equipo(uuid, uuid) from public, anon;
grant execute on function public.agregar_al_equipo(uuid, uuid, role_enum) to authenticated, service_role;
grant execute on function public.quitar_del_equipo(uuid, uuid) to authenticated, service_role;

/**
 * El equipo con sus correos.
 *
 * Los correos viven en `auth.users`, que no se puede consultar desde la API.
 * Esta vista los expone **solo para los negocios de los que uno es miembro**,
 * y nada más: ni la contraseña, ni los metadatos, ni cuándo entró por última
 * vez.
 */
create or replace view public.equipo_del_negocio
with (security_invoker = true) as
  select
    m.workspace_id,
    m.user_id,
    m.role,
    m.created_at,
    u.email
  from public.workspace_members m
  join auth.users u on u.id = m.user_id;

comment on view public.equipo_del_negocio is
  'Miembros de cada workspace con su correo. security_invoker: hereda el RLS de workspace_members, así que solo devuelve equipos propios.';

grant select on public.equipo_del_negocio to authenticated;
