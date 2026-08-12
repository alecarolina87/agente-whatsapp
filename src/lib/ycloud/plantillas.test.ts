import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  NOMBRE_VALIDO,
  construirComponentes,
  contarVariables,
  sugerirNombre,
  traducirEstado,
} = await import("./plantillas");

describe("sugerirNombre", () => {
  /*
   * Es la trampa más fácil de esta API: Meta solo acepta minúsculas, números y
   * guiones bajos. Un nombre con tildes o espacios no falla al escribirlo —
   * falla al enviarlo, cuando ya nadie relaciona una cosa con la otra.
   */
  it("quita acentos, espacios y signos", () => {
    expect(sugerirNombre("Recordatorio de Cita — Clínica Dental")).toBe(
      "recordatorio_de_cita_clinica_dental",
    );
  });

  it("no deja guiones bajos sueltos en los extremos", () => {
    expect(sugerirNombre("  ¡Oferta!  ")).toBe("oferta");
  });

  it("lo que sugiere siempre vale para Meta", () => {
    const titulos = [
      "Recordatorio de cita",
      "¿Confirmas tu cita?",
      "Promoción 2×1 — Junio",
      "Seguimiento post-tratamiento",
    ];

    for (const titulo of titulos) {
      expect(NOMBRE_VALIDO.test(sugerirNombre(titulo))).toBe(true);
    }
  });
});

describe("contarVariables", () => {
  it("cuenta las que hay", () => {
    expect(contarVariables("Hola {{1}}, tu cita es el {{2}}")).toBe(2);
  });

  it("sin variables devuelve cero", () => {
    expect(contarVariables("Te esperamos mañana")).toBe(0);
  });

  it("tolera espacios dentro de las llaves", () => {
    expect(contarVariables("Hola {{ 1 }}")).toBe(1);
  });

  /*
   * El caso que justifica devolver el número más alto y no cuántas hay: con
   * `{{1}}` y `{{3}}` hacen falta **tres** valores. Si se mandaran dos, Meta
   * rechaza el mensaje entero y la clienta no recibe nada.
   */
  it("con huecos salteados pide hasta el número más alto", () => {
    expect(contarVariables("Hola {{1}}, te atiende {{3}}")).toBe(3);
  });
});

describe("construirComponentes", () => {
  const base = {
    nombre: "recordatorio",
    idioma: "es",
    categoria: "utility" as const,
    cuerpo: "Hola {{1}}",
  };

  it("el cuerpo siempre va, y es lo único obligatorio", () => {
    expect(construirComponentes(base)).toEqual([{ type: "BODY", text: "Hola {{1}}" }]);
  });

  it("añade cabecera, pie y botones cuando los hay", () => {
    const componentes = construirComponentes({
      ...base,
      cabecera: "Tu cita",
      pie: "Clínica Dental One",
      botones: [
        { tipo: "respuesta_rapida", texto: "Confirmar" },
        { tipo: "url", texto: "Ver mapa", url: "https://ejemplo.com" },
      ],
    });

    expect(componentes.map((c) => c.type)).toEqual(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
    expect(componentes[3].buttons).toEqual([
      { type: "QUICK_REPLY", text: "Confirmar" },
      { type: "URL", text: "Ver mapa", url: "https://ejemplo.com" },
    ]);
  });

  // Una cabecera con espacios no es una cabecera. Mandarla vacía hace que Meta
  // rechace la plantilla por un campo que quien la escribió creía no haber puesto.
  it("ignora cabecera y pie en blanco", () => {
    const componentes = construirComponentes({ ...base, cabecera: "   ", pie: "" });
    expect(componentes.map((c) => c.type)).toEqual(["BODY"]);
  });
});

describe("traducirEstado", () => {
  it("pasa los estados de Meta a los nuestros", () => {
    expect(traducirEstado("APPROVED")).toBe("approved");
    expect(traducirEstado("REJECTED")).toBe("rejected");
    expect(traducirEstado("IN_APPEAL")).toBe("in_appeal");
  });

  /*
   * Un estado que no conocemos no se descarta: se pasa en minúsculas y que
   * decida la base de datos. Perder un cambio de estado por no conocer un
   * nombre nuevo sería peor que fallar de forma visible.
   */
  it("no se traga un estado desconocido en silencio", () => {
    expect(traducirEstado("ALGO_NUEVO")).toBe("algo_nuevo");
  });
});
