-- ═══════════════════════════════════════════════════════════════════════════
-- Se retira el almacén de archivos
--
-- El 2 de agosto se construyó para que las fotos que mandan las clientas se
-- vieran en la bandeja. El 4 de agosto se decide que **no se guarda ninguna**,
-- y no por una limitación técnica.
--
-- El motivo: por aquí pasan radiografías, cicatrices y piel de pacientes. Al
-- llevar clientes de terceros —una clínica dental— guardar esos archivos
-- convierte a la agencia en encargada del tratamiento de datos de salud de
-- personas que ni saben que existe. Eso obliga a un contrato de encargo, a una
-- política de retención, a poder borrar a una persona concreta si lo pide, y a
-- responder si algo se filtra.
--
-- La minimización de datos es la única obligación del RGPD que quita trabajo en
-- vez de darlo: lo que no se guarda no hay que retenerlo, ni borrarlo, ni
-- justificarlo. Y se convierte en argumento de venta — a una clínica se le
-- puede decir que su agente no almacena ni una imagen de sus pacientes.
--
-- Lo que sí se conserva: que llegó un archivo, de qué tipo y su pie de foto.
-- Quien atiende lo abre en su WhatsApp, que es donde ya estaba.
-- ═══════════════════════════════════════════════════════════════════════════

/*
 * El bucket NO se borra desde aquí.
 *
 * Supabase prohíbe tocar las tablas de Storage por SQL —«Direct deletion from
 * storage tables is not allowed»— y obliga a usar su API. Se hace con
 * `scripts/retirar-almacen.mjs`, que además vacía el bucket antes: uno con
 * contenido no se puede eliminar.
 *
 * Esta migración se queda como el sitio donde consta la decisión y su porqué,
 * que es lo que hará falta dentro de seis meses cuando alguien pregunte por qué
 * no se ven las fotos.
 */

/*
 * La columna `messages.media` se queda.
 *
 * Existe desde el esquema inicial, hoy está a `null` en todas las filas y no
 * cuesta nada. Borrarla obligaría a una migración de vuelta si algún día un
 * cliente pide guardar sus propios archivos en su propia infraestructura, que
 * es la única forma en que esto volvería a tener sentido.
 */
comment on column messages.media is
  'Sin uso desde 2026-08-04: la plataforma no almacena archivos. Ver 20260804180000_sin_archivos.sql.';
