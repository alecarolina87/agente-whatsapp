-- ═══════════════════════════════════════════════════════════════════════════
-- Texto libre en la ficha del negocio
--
-- La ficha nació solo con campos estructurados —servicios, preguntas,
-- objeciones—, y eso está bien para lo que se consulta mucho. Pero obliga a
-- rellenar quince casillas antes de que el agente sepa nada, y quien da de alta
-- a un cliente a las once de la noche no rellena quince casillas: lo deja para
-- luego y se queda vacío para siempre.
--
-- Con un cuadro de texto libre, en dos minutos el agente ya sabe de qué va el
-- negocio. Los campos estructurados se rellenan después, o los rellena el
-- scraper leyendo su web.
--
-- No sustituye a los estructurados y por eso convive con ellos: un precio
-- suelto dentro de un párrafo el modelo lo encuentra a veces; en una lista, lo
-- encuentra siempre.
-- ═══════════════════════════════════════════════════════════════════════════

alter table business_info
  add column if not exists texto_libre text;

comment on column business_info.texto_libre is
  'Lo que sea, contado a mano. Se inyecta antes que los campos estructurados.';

/*
 * El país del negocio.
 *
 * Hace falta para normalizar teléfonos: hasta ahora se daba por hecho que un
 * número de nueve cifras era español, lo cual es cierto para los clientes de
 * hoy y falso en cuanto haya uno en Chile o México. El prefijo se guarda ya en
 * formato E.164 para no tener que traducir de código de país a prefijo.
 */
alter table workspaces
  add column if not exists prefijo_pais text not null default '+34';

comment on column workspaces.prefijo_pais is
  'Prefijo internacional por defecto para normalizar teléfonos locales. E.164, con el +.';
