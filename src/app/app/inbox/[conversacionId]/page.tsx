import { notFound } from "next/navigation";

import { PanelConversacion } from "@/components/inbox/PanelConversacion";
import { cargarHilo } from "@/lib/data/inbox";
import { negocioActual } from "@/lib/data/negocios";
import { plantillasAprobadas } from "@/lib/data/plantillas";

export default async function PaginaConversacion({
  params,
}: {
  params: Promise<{ conversacionId: string }>;
}) {
  const { conversacionId } = await params;

  const negocio = await negocioActual();
  if (!negocio) notFound();

  const hilo = await cargarHilo(negocio.id, conversacionId);

  /*
   * `cargarHilo` devuelve `null` tanto si la conversación no existe como si es
   * de otro workspace, y aquí las dos cosas acaban en el mismo 404. Es
   * deliberado: distinguirlas le diría a quien prueba identificadores al azar
   * cuáles existen.
   */
  if (!hilo) notFound();

  /*
   * Las plantillas se cargan siempre, aunque la ventana esté abierta. Saber si
   * está cerrada depende de la hora, y la hora solo la sabe el navegador — si
   * se decidiera aquí, una conversación abierta a las 23:59 enseñaría el cuadro
   * de texto y a las 00:01 seguiría enseñándolo.
   */
  const plantillas = await plantillasAprobadas(negocio.id);

  // Marcar como leída es un efecto, y los efectos no van en el render: React
  // puede renderizar esto más de una vez y la escritura se repetiría. Lo hace
  // el panel al montarse, una sola vez.
  return (
    <PanelConversacion hilo={hilo} plantillas={plantillas} negocioId={negocio.id} />
  );
}
