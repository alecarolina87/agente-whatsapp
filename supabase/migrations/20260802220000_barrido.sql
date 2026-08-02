-- ═══════════════════════════════════════════════════════════════════════════
-- Barrido del buffer, cada minuto
--
-- El buffer junta los mensajes seguidos de una misma persona para contestar
-- una vez en lugar de tres. Pero alguien tiene que preguntar «¿ya se cumplió
-- el silencio?», y hasta ahora ese alguien era yo llamando al endpoint a mano.
-- Sin esto, en producción nadie contestaría nunca.
--
-- ## Por qué en Supabase y no en Vercel
--
-- Vercel, en plan gratuito, permite **un cron al día**. Para un buffer que
-- espera treinta segundos eso no sirve de nada. `pg_cron` baja a un minuto y
-- ya está pagado dentro de Supabase.
--
-- ## Por qué el secreto no está escrito aquí
--
-- La definición de un cron se puede leer desde `cron.job`. Poner ahí la clave
-- que protege el endpoint interno sería dejarla en una tabla consultable. Se
-- saca de Vault en el momento de la llamada, igual que hace el resto del
-- sistema con las credenciales de cada cliente.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

/**
 * Llama al endpoint que procesa los lotes vencidos.
 *
 * `net.http_post` no espera la respuesta: encola la petición y devuelve al
 * instante. Es lo que queremos — el cron no debe quedarse bloqueado mientras
 * el agente piensa, y si la llamada falla, el minuto siguiente lo reintenta.
 */
create or replace function public.barrer_buffer()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text;
  v_secreto text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'plataforma:flush:url';

  select decrypted_secret into v_secreto
    from vault.decrypted_secrets where name = 'plataforma:flush:secreto';

  /*
   * Sin configurar, no se hace nada y no se protesta. La migración se aplica
   * antes de que exista la URL de producción —no se puede saber antes de
   * desplegar—, y un error cada minuto llenaría los logs de ruido por algo
   * que es simplemente "todavía no".
   */
  if v_url is null or v_secreto is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secreto
    ),
    body    := '{}'::jsonb
  );
end;
$$;

-- Nadie más que el propio cron necesita esto. `security definer` sin revocar
-- sería una función que cualquiera con sesión puede disparar en bucle.
revoke all on function public.barrer_buffer() from public, anon, authenticated;

/*
 * Cada minuto, que es lo más frecuente que admite pg_cron.
 *
 * Con el buffer en 30 s, una clienta espera entre 30 y 90 segundos por la
 * respuesta. Es asumible para pedir cita y es el precio de no responder tres
 * veces a quien escribe a trozos.
 *
 * `unschedule` antes por si la migración se aplica dos veces: `schedule`
 * duplicaría el trabajo en vez de fallar.
 */
select cron.unschedule('barrer-buffer')
  where exists (select 1 from cron.job where jobname = 'barrer-buffer');

select cron.schedule('barrer-buffer', '* * * * *', 'select public.barrer_buffer()');
