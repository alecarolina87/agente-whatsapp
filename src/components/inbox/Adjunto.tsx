import type { MediaDelMensaje } from "@/lib/data/inbox-tipos";

/**
 * El archivo de un mensaje, dentro de su burbuja.
 *
 * Se pinta según el tipo y no con un icono genérico porque el caso de uso lo
 * pide: la mayoría de estos archivos son fotos que hay que **mirar** para
 * contestar —cejas antes de una cita, una cicatrización a los cinco días—, y
 * tener que abrir cada una en otra pestaña convierte revisar la bandeja en un
 * trabajo.
 *
 * No usa `next/image` a propósito: la URL viene firmada y caduca, así que el
 * optimizador la cachearía y a la hora serviría un enlace muerto.
 */

function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Cómo llamar a cada cosa cuando hay que decir que no se pudo recuperar. */
const NOMBRE_DEL_TIPO: Record<string, string> = {
  image: "una foto",
  audio: "una nota de voz",
  video: "un vídeo",
  document: "un documento",
};

/** Si el mensaje traía un archivo, aunque no se haya podido guardar. */
export function esArchivo(tipo: string): boolean {
  return tipo in NOMBRE_DEL_TIPO;
}

export function Adjunto({ tipo, media }: { tipo: string; media: MediaDelMensaje | null }) {
  /*
   * Un mensaje de tipo archivo **sin** archivo: la descarga falló, casi siempre
   * porque el enlace de YCloud caducó antes de bajarlo.
   *
   * Hay que decirlo. Sin este aviso el mensaje se vería como texto normal —o
   * como una burbuja vacía— y quien lo lee no sabría que le mandaron una foto.
   * Eso es peor que un error visible: es un error invisible.
   */
  if (!media) {
    if (!NOMBRE_DEL_TIPO[tipo]) return null;

    return (
      <p className="rounded-[var(--radius-control)] border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Te envió {NOMBRE_DEL_TIPO[tipo]} que no se pudo recuperar. Pídesela otra vez.
      </p>
    );
  }

  // Guardado pero sin poder firmar la URL: el archivo está, no se puede servir.
  if (!media.url) {
    return (
      <p className="rounded-[var(--radius-control)] border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        No se pudo abrir el archivo ({media.nombre}).
      </p>
    );
  }

  const familia = media.mime.split("/")[0];

  if (familia === "image") {
    return (
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={`Archivo enviado por el contacto: ${media.nombre}`}
          className="max-h-64 w-auto rounded-[var(--radius-control)] object-cover"
          loading="lazy"
        />
      </a>
    );
  }

  if (familia === "audio") {
    // Las notas de voz se escuchan aquí mismo: son el adjunto que más veces
    // llega y abrirlas fuera perdería el hilo de la conversación.
    return <audio controls src={media.url} className="max-w-full" />;
  }

  if (familia === "video") {
    return <video controls src={media.url} className="max-h-64 rounded-[var(--radius-control)]" />;
  }

  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2 text-xs hover:bg-muted"
    >
      <span aria-hidden="true">📎</span>
      <span className="truncate">{media.nombre}</span>
      <span className="dato text-muted-foreground">{pesoLegible(media.bytes)}</span>
    </a>
  );
}
