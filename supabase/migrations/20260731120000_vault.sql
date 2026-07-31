-- ============================================================================
-- F1 · Almacén de secretos (Vault)
--
-- El esquema de F0 dejó las columnas preparadas —`channels.ycloud_credential_ref`
-- y `channels.webhook_secret_ref`— pero apuntando a nada. Esta migración crea
-- lo que hay al otro lado.
--
-- POR QUÉ NO VALEN LAS VARIABLES DE ENTORNO
--
-- Con un solo cliente, `.env` parece suficiente. Con dos deja de serlo: cada
-- cliente tiene su propia cuenta de YCloud, con su clave y su secreto de
-- webhook, y las claves de un cliente no se guardan en el despliegue de la
-- plataforma. Además, dar de alta un cliente nuevo no puede exigir un
-- despliegue: se hace desde la aplicación, y la aplicación no puede escribir
-- en `.env`.
--
-- POR QUÉ POR FUNCIONES Y NO LEYENDO LA TABLA
--
-- `vault.decrypted_secrets` descifra al leerla. Si se le diera acceso directo a
-- la aplicación, cualquier consulta mal filtrada devolvería las claves de todos
-- los clientes en claro. Con estas dos funciones, lo único que se puede hacer es
-- guardar un secreto y leer **uno** por su identificador.
-- ============================================================================

create extension if not exists supabase_vault with schema vault;

-- ── Guardar ─────────────────────────────────────────────────────────────────
-- Idempotente a propósito: volver a ejecutar el script de alta de un cliente no
-- debe llenar el almacén de copias del mismo secreto. Si el nombre ya existe,
-- se actualiza el valor y se devuelve el mismo identificador, así que las
-- columnas `*_ref` que ya apuntaban ahí siguen siendo válidas.
create or replace function public.guardar_secreto(p_nombre text, p_valor text)
returns uuid
language plpgsql
security definer
-- Sin `search_path` vacío, quien pudiera crear una tabla llamada `secrets` en
-- un esquema anterior en la ruta secuestraría lo que hace esta función. Al
-- vaciarlo, todo va cualificado y no hay ambigüedad posible.
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_nombre;

  if v_id is null then
    v_id := vault.create_secret(p_valor, p_nombre);
  else
    perform vault.update_secret(v_id, p_valor);
  end if;

  return v_id;
end;
$$;

comment on function public.guardar_secreto(text, text) is
  'Guarda o actualiza un secreto en Vault y devuelve su id, que es lo que se '
  'escribe en las columnas *_ref. Solo service_role.';

-- ── Leer ────────────────────────────────────────────────────────────────────
-- Uno y solo uno, por identificador. No hay forma de pedir "todos".
create or replace function public.leer_secreto(p_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = p_id;
$$;

comment on function public.leer_secreto(uuid) is
  'Devuelve el valor descifrado de un secreto por su id. Solo service_role.';

-- ── Permisos ────────────────────────────────────────────────────────────────
-- ESTO ES LO MÁS IMPORTANTE DE LA MIGRACIÓN.
--
-- En PostgreSQL, una función recién creada la puede ejecutar PUBLIC por
-- defecto. Y como estas son SECURITY DEFINER, se ejecutan con los permisos de
-- quien las creó. Sin los REVOKE de abajo, cualquier usuario con sesión
-- iniciada podría llamar a `leer_secreto` por RPC y sacar las claves de YCloud
-- de todos los clientes. El GRANT no basta: hay que quitar primero.
revoke all on function public.guardar_secreto(text, text) from public, anon, authenticated;
revoke all on function public.leer_secreto(uuid)          from public, anon, authenticated;

grant execute on function public.guardar_secreto(text, text) to service_role;
grant execute on function public.leer_secreto(uuid)          to service_role;
