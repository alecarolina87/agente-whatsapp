import { notFound } from "next/navigation";

import { PanelConversacion } from "@/components/inbox/PanelConversacion";
import { cargarHilo, workspaceActual } from "@/lib/data/inbox";

export default async function PaginaConversacion({
  params,
}: {
  params: Promise<{ conversacionId: string }>;
}) {
  const { conversacionId } = await params;

  const workspace = await workspaceActual();
  if (!workspace) notFound();

  const hilo = await cargarHilo(workspace.id, conversacionId);

  /*
   * `cargarHilo` devuelve `null` tanto si la conversación no existe como si es
   * de otro workspace, y aquí las dos cosas acaban en el mismo 404. Es
   * deliberado: distinguirlas le diría a quien prueba identificadores al azar
   * cuáles existen.
   */
  if (!hilo) notFound();

  // Marcar como leída es un efecto, y los efectos no van en el render: React
  // puede renderizar esto más de una vez y la escritura se repetiría. Lo hace
  // el panel al montarse, una sola vez.
  return <PanelConversacion hilo={hilo} />;
}
