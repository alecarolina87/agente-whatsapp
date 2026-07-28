-- ============================================================================
-- F0 · Permisos de tabla (GRANTs)
--
-- El proyecto se creó con "Automatically expose new tables" DESACTIVADO, así que
-- las tablas nacen sin permisos para nadie. Aquí se conceden uno a uno.
--
-- Son dos capas distintas y hacen falta las dos:
--   GRANT  → ¿puede este rol tocar la tabla?      (permiso de tabla)
--   RLS    → ¿qué filas concretas puede tocar?    (permiso de fila)
--
-- Sin GRANT, RLS no llega ni a evaluarse. Con GRANT pero sin RLS, se vería todo.
--
-- Criterio: los permisos se conceden EXACTAMENTE donde hay una política que los
-- gobierne. Si una tabla no tiene política de insert para authenticated, tampoco
-- recibe el permiso.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- ── service_role ────────────────────────────────────────────────────────────
-- Es el servidor: webhook, motor del agente, tareas programadas. Se salta RLS
-- por diseño, y por eso todo el código de servidor pasa por la capa de datos
-- que exige workspace_id (§7 del blueprint).

grant all on all tables in schema public to service_role;

-- ── anon ────────────────────────────────────────────────────────────────────
-- Sin sesión iniciada no se accede a nada. No se concede NADA a propósito:
-- es una plataforma de gestión, no una web pública.

-- (ausencia deliberada de grants)

-- ── authenticated ───────────────────────────────────────────────────────────
-- Cada permiso corresponde a una política del archivo de RLS.

-- workspaces: se ve, se edita y se borra (admin); crear va por servidor
grant select, update, delete on workspaces to authenticated;

-- workspace_members: gestión del equipo por admin
grant select, insert, update, delete on workspace_members to authenticated;

-- channels e integrations: ve cualquier miembro, gestionan admin y manager
grant select, insert, update, delete on channels to authenticated;
grant select, insert, update, delete on integrations to authenticated;

-- contacts y conversations: el trabajo diario del inbox
grant select, insert, update, delete on contacts to authenticated;
grant select, insert, update, delete on conversations to authenticated;

-- messages: se leen y se escriben, pero NO se editan ni se borran.
-- Son el registro de lo que pasó; no hay política de update/delete y tampoco
-- se concede el permiso. Doble cierre a propósito.
grant select, insert on messages to authenticated;

-- events: log de decisión, solo lectura. Lo escribe el service-role (§6.1).
grant select on events to authenticated;

-- processed_events: fontanería de idempotencia. La app nunca la consulta,
-- así que authenticated no recibe ningún permiso.

-- ── Tablas futuras ──────────────────────────────────────────────────────────
-- Que las tablas nuevas tampoco nazcan expuestas por accidente: sin privilegios
-- por defecto para anon ni authenticated. Cada tabla que se cree tendrá que
-- conceder sus permisos explícitamente, igual que estas.

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;
