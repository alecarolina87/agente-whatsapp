-- ═══════════════════════════════════════════════════════════════════════════
-- Borrar un negocio del todo
--
-- Las trece tablas que cuelgan de `workspaces` se van solas con la cascada.
-- Lo que NO se va, y por eso existe este archivo:
--
--   1. Sus claves en Vault (`ws:<id>:ycloud:*`).
--   2. Sus archivos en Storage (`whatsapp-media/<id>/...`).
--
-- El segundo importa de verdad. Ahí hay fotos que mandaron pacientes y
-- clientas. Si un negocio deja de ser cliente y se borra, esas fotos no pueden
-- quedarse en la base de datos de la agencia: es dato de salud de personas que
-- nunca supieron que existíamos.
--
-- Los archivos los borra la aplicación —Storage no se maneja bien desde SQL— y
-- los secretos, esta función.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.borrar_secretos_del_negocio(p_workspace_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borrados int;
begin
  /*
   * Por el nombre y no por la referencia guardada en `channels`, a propósito:
   * si el canal ya se borró, o si alguna vez se guardó un secreto que nadie
   * llegó a referenciar, por la referencia no se encontraría. El prefijo los
   * pilla todos.
   */
  with fuera as (
    delete from vault.secrets
     where name like 'ws:' || p_workspace_id::text || ':%'
     returning 1
  )
  select count(*) into v_borrados from fuera;

  return v_borrados;
end;
$$;

comment on function public.borrar_secretos_del_negocio(uuid) is
  'Borra de Vault todos los secretos de un workspace. La cascada no los alcanza porque Vault vive fuera del esquema público.';

-- Solo el servidor. Esta función se salta RLS por definición, así que quien la
-- llame tiene que haber comprobado antes que puede borrar ese negocio.
revoke all on function public.borrar_secretos_del_negocio(uuid) from public, anon, authenticated;
grant execute on function public.borrar_secretos_del_negocio(uuid) to service_role;
