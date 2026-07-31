"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Mantiene la lista de conversaciones al día.
 *
 * No pinta nada: solo escucha. Cuando entra un mensaje o cambia una
 * conversación en *este* workspace, le pide al servidor que vuelva a
 * renderizar la lista.
 *
 * Está separado de la lista a propósito. La lista es un componente de servidor
 * —se pinta entera en el servidor, sin enviar datos ni lógica al navegador— y
 * meterle `"use client"` para poder escuchar la convertiría en cliente, con
 * todo lo que eso arrastra. Así se queda cada cosa donde le corresponde.
 *
 * El filtro por `workspace_id` no es cosmético: sin él, el navegador de un
 * cliente recibiría avisos de la actividad de otro. Realtime respeta RLS para
 * el contenido, pero es mejor no pedir siquiera lo que no toca.
 */
export function ListaEnVivo({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    const canal = supabase
      .channel(`inbox:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [workspaceId, router]);

  return null;
}
