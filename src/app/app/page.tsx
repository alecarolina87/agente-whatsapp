import { redirect } from "next/navigation";

/**
 * La portada del área privada es la lista de negocios.
 *
 * Antes había aquí una pantalla de andamio con el estado de las fases del
 * proyecto. Servía mientras esto era un proyecto en construcción y estorbaba en
 * cuanto dejó de serlo: quien entra viene a atender a sus clientes, no a leer
 * en qué fase va el desarrollo.
 *
 * El freno de mano que vivía en esta página vuelve en la ficha de cada negocio,
 * que es donde tiene sentido: se para el agente de *un* cliente, no el de todos.
 */
export default function PaginaApp() {
  redirect("/app/negocios");
}
