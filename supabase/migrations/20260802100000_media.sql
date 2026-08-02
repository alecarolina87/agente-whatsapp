-- ═══════════════════════════════════════════════════════════════════════════
-- Archivos de WhatsApp · almacén privado
--
-- Los enlaces que da YCloud caducan. Si no se descarga el archivo en el
-- momento, la foto que mandó la clienta se pierde para siempre y en la bandeja
-- queda un mensaje vacío.
--
-- El bucket es **privado**. Son fotos de la piel de personas reales —cejas
-- recién pigmentadas, procesos de cicatrización—: un bucket público sería una
-- galería de datos de salud accesible con adivinar una URL.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media',
  'whatsapp-media',
  false,
  -- WhatsApp ya limita: 16 MB vídeo/audio, 100 MB documento. 25 MB cubre todo
  -- lo que llega de verdad en una conversación de citas y evita que un envío
  -- raro llene el almacenamiento.
  26214400,
  null  -- el filtro de tipos se hace en la aplicación, con su propia lista
)
on conflict (id) do nothing;

-- ── Acceso ─────────────────────────────────────────────────────────────────
--
-- Deny-by-default, igual que el resto del esquema: no se crea ninguna policy
-- de `select`/`insert` para `authenticated`, así que **nadie llega al archivo
-- por la API pública de Storage**.
--
-- Se sirve solo mediante URLs firmadas que genera el servidor con la clave de
-- servicio, y únicamente después de comprobar que quien mira pertenece al
-- workspace. La comprobación vive en la aplicación porque la ruta del objeto
-- (`{workspace}/{conversacion}/…`) no es una llave de confianza: quien pudiera
-- escribir la ruta a mano se saltaría cualquier policy basada en ella.

-- ── Qué contesta el agente cuando llega un archivo ─────────────────────────
--
-- Cuando alguien manda una foto, el agente **no opina**: avisa, y pasa la
-- conversación a una persona.
--
-- El motivo es concreto y no es de diseño: el modelo no ve la imagen. Si se le
-- dejara responder, escribiría sobre una foto que no ha mirado — y en el
-- negocio de Ale eso significa decirle a una clienta que su cicatrización «se
-- ve bien» sin haberla visto. Un archivo es, por definición, un caso para una
-- persona.
--
-- El texto vive en la base de datos y no en el código por lo mismo que el
-- `system_prompt`: cada cliente habla como habla, y cambiar el suyo no puede
-- exigir un despliegue.

alter table channels
  add column if not exists respuesta_a_archivos text
    not null
    default 'He recibido tu archivo. Lo revisa una persona del equipo y te responde en cuanto pueda.';

comment on column channels.respuesta_a_archivos is
  'Acuse que se envía al recibir un adjunto, antes de pasar la conversación a una persona. No lo escribe el modelo: no ve el archivo.';
