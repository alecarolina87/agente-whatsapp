import { registrarse } from "../acciones";
import { FormularioAuth } from "../FormularioAuth";

export const metadata = { title: "Crear cuenta · Agente de WhatsApp" };

export default function PaginaRegistro() {
  return (
    <FormularioAuth
      accion={registrarse}
      titulo="Crear cuenta"
      descripcion="Empieza a atender tu WhatsApp con IA."
      textoBoton="Crear cuenta"
      pie={{ texto: "¿Ya tienes cuenta?", enlace: "Entra", href: "/entrar" }}
    />
  );
}
