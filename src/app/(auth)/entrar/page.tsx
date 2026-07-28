import { iniciarSesion } from "../acciones";
import { FormularioAuth } from "../FormularioAuth";

export const metadata = { title: "Entrar · Agente de WhatsApp" };

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ registro?: string }>;
}) {
  const { registro } = await searchParams;

  return (
    <div className="flex w-full flex-col items-center">
      {registro === "ok" && (
        <p className="mb-5 w-full max-w-sm rounded-[var(--radius-control)] border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          Cuenta creada. Revisa tu correo para confirmarla y entra.
        </p>
      )}

      <FormularioAuth
        accion={iniciarSesion}
        titulo="Entrar"
        descripcion="Accede al inbox de tu equipo."
        textoBoton="Entrar"
        pie={{ texto: "¿Aún no tienes cuenta?", enlace: "Créala", href: "/registro" }}
      />
    </div>
  );
}
