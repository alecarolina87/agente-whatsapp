import { describe, expect, it } from "vitest";

import { leerLista } from "./importar";

describe("leerLista", () => {
  it("lee teléfono y nombre separados por coma", () => {
    const r = leerLista("+34 600 00 00 00, María");

    expect(r.validas).toEqual([{ telefono: "+34600000000", nombre: "María" }]);
    expect(r.descartadas).toHaveLength(0);
  });

  /*
   * El tabulador es el caso real: es lo que sale al copiar dos columnas de
   * Excel. Si solo se aceptara la coma, la importación fallaría justo con la
   * forma en que la gente trae de verdad sus datos.
   */
  it("acepta coma, punto y coma y tabulador", () => {
    const r = leerLista("600000001, Ana\n600000002;Lucía\n600000003\tPedro");

    expect(r.validas.map((v) => v.nombre)).toEqual(["Ana", "Lucía", "Pedro"]);
  });

  it("acepta una lista de teléfonos sin nombres", () => {
    const r = leerLista("600000001\n600000002");

    expect(r.validas).toEqual([
      { telefono: "+34600000001", nombre: null },
      { telefono: "+34600000002", nombre: null },
    ]);
  });

  it("normaliza el mismo número escrito de varias formas", () => {
    const r = leerLista("+34 600 00 00 00\n34600000000\n0034600000000");

    // Los tres son la misma persona: entra una vez y las otras dos cuentan
    // como repetidas, no como error.
    expect(r.validas).toHaveLength(1);
    expect(r.repetidas).toBe(2);
    expect(r.descartadas).toHaveLength(0);
  });

  it("ignora líneas en blanco sin quejarse", () => {
    const r = leerLista("600000001\n\n\n600000002\n");

    expect(r.validas).toHaveLength(2);
    expect(r.descartadas).toHaveLength(0);
  });

  /*
   * La cabecera de Excel se cuela casi siempre. Descartarla en silencio haría
   * que el recuento no cuadrara sin explicación; por eso sale en la lista de
   * descartes con su motivo.
   */
  it("descarta la cabecera y dice por qué", () => {
    const r = leerLista("telefono,nombre\n600000001,Ana");

    expect(r.validas).toHaveLength(1);
    expect(r.descartadas).toEqual([
      { linea: 1, texto: "telefono,nombre", motivo: "no parece un teléfono" },
    ]);
  });

  it("conserva los nombres con coma dentro", () => {
    const r = leerLista("600000001, Pérez, María");

    expect(r.validas[0].nombre).toBe("Pérez María");
  });

  it("apunta el número de línea de lo que descarta", () => {
    const r = leerLista("600000001,Ana\nesto no vale\n600000002,Lucía");

    expect(r.validas).toHaveLength(2);
    expect(r.descartadas[0].linea).toBe(2);
  });
});
