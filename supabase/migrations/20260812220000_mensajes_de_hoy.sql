-- ============================================================================
-- Cuántos mensajes ha habido hoy
--
-- POR QUÉ HACE FALTA
--
-- La pantalla de Actividad cuenta el mes, que sirve para justificar la factura.
-- No sirve para la pregunta con la que se abre la aplicación entre clienta y
-- clienta: **¿está pasando algo ahora?**
--
-- Un negocio con 400 mensajes este mes y 0 hoy puede tener el webhook caído
-- desde ayer, y el número del mes seguiría estando estupendo.
--
-- POR QUÉ EN POSTGRES Y NO EN LA APLICACIÓN
--
-- Igual que `gasto_del_mes`: contar aquí devuelve un número; contar en la
-- aplicación obliga a traerse los mensajes del día de todos los negocios. Con
-- cuatro clientes es lo mismo; con cuarenta, es traerse media base de datos
-- para pintar una cifra.
-- ============================================================================

create or replace function public.mensajes_de_hoy(p_workspace_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::integer
  from public.messages
  where workspace_id = p_workspace_id
    /*
     * «Hoy» en hora de España, no en UTC.
     *
     * La base de datos vive en UTC, donde el día cambia a la 01:00 o las 02:00
     * hora peninsular. Sin esta conversión, un mensaje de las 00:30 contaría
     * como de ayer y el contador diría «0 hoy» justo después de que llegara
     * uno — que es exactamente cuando se mira.
     *
     * DEUDA CONOCIDA: está fijado a Europe/Madrid porque hoy todos los clientes
     * son españoles. El día que haya uno fuera, esto y la normalización de
     * teléfonos necesitan lo mismo: una zona y un prefijo por negocio.
     */
    and created_at >= (date_trunc('day', now() at time zone 'Europe/Madrid')
                       at time zone 'Europe/Madrid');
$$;

comment on function public.mensajes_de_hoy(uuid) is
  'Mensajes de hoy (hora de España) en un negocio, entrantes y salientes.';

-- Una función recién creada la puede ejecutar PUBLIC por defecto. Aquí el dato
-- no es un secreto, pero la actividad de un cliente no tiene por qué verla otro.
revoke all on function public.mensajes_de_hoy(uuid) from public, anon;
grant execute on function public.mensajes_de_hoy(uuid) to authenticated, service_role;

-- Contar los de hoy recorre los mensajes del negocio por fecha. Sin índice, con
-- un histórico grande, esto pasa de instantáneo a notarse en cada carga.
create index if not exists messages_workspace_fecha_idx
  on messages (workspace_id, created_at desc);
