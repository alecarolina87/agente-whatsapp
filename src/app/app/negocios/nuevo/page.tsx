import Link from "next/link";

import { FormularioAlta } from "@/components/negocios/FormularioAlta";

export const metadata = { title: "Dar de alta un negocio · Agente de WhatsApp" };

export default function PaginaNuevoNegocio() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href="/app/negocios"
          className="dato text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← Mis negocios
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Dar de alta un negocio
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Con esto nace todo: su espacio aislado, su número y su agente. Lo único
          imprescindible es el nombre y el teléfono; el WhatsApp puedes
          conectarlo ahora o más tarde.
        </p>
      </div>

      <FormularioAlta />
    </div>
  );
}
