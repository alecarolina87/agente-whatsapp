/**
 * Aviso de que llegó un archivo, sin el archivo.
 *
 * ## Por qué no se ve aquí la foto
 *
 * Es una decisión de producto, no una limitación. Por este sistema pasan
 * radiografías, cicatrices y piel de pacientes y clientas. Guardar esos
 * archivos convertiría a quien opera la plataforma en encargada del
 * tratamiento de datos de salud de personas que ni saben que existe, con el
 * contrato y las obligaciones que eso arrastra.
 *
 * Lo que se hace en su lugar: registrar **que llegó**, de qué tipo, y su pie de
 * foto. Quien atiende la abre en su WhatsApp, que es donde ya estaba y donde le
 * corresponde estar.
 *
 * Y es argumento de venta: se le puede decir a una clínica que su agente no
 * almacena ni una imagen de sus pacientes.
 */

const NOMBRE_DEL_TIPO: Record<string, string> = {
  image: "una foto",
  audio: "una nota de voz",
  video: "un vídeo",
  document: "un documento",
};

/** Si el mensaje traía un archivo. */
export function esArchivo(tipo: string): boolean {
  return tipo in NOMBRE_DEL_TIPO;
}

export function Adjunto({ tipo }: { tipo: string }) {
  const nombre = NOMBRE_DEL_TIPO[tipo];
  if (!nombre) return null;

  return (
    <p className="flex items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      <span aria-hidden="true">📎</span>
      <span>
        Te envió {nombre}. Ábrela en WhatsApp —{" "}
        <span className="text-foreground">aquí no se guarda</span>.
      </span>
    </p>
  );
}
