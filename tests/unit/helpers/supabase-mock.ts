/**
 * Un doble del cliente de Supabase para los tests unitarios.
 *
 * Existe para cubrir lo que **no** depende de PostgREST: el mapeo de la
 * respuesta a los tipos del dominio, qué filtros termina aplicando cada query, y
 * el manejo de errores. Todo eso es lógica nuestra y no necesita una base.
 *
 * Lo que este mock **no** puede verificar es si el string de un embed
 * (`project:projects!inner (...)`) es válido, porque eso lo resuelve PostgREST
 * en el servidor. Ese nivel lo cubre `tests/smoke/`, contra el stack efímero de
 * CI. Ver `docs/testing.md`: la separación es deliberada, no una omisión.
 */

export type MockResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

/** Una operación encadenada, tal como la llamó el código bajo prueba. */
export type RecordedOp = { name: string; args: unknown[] };

export type RecordedQuery = {
  table: string;
  columns: string;
  ops: RecordedOp[];
  /** Azúcar para aserciones: `filters.eq` son los pares de cada `.eq(...)`. */
  filters: {
    eq: [string, unknown][];
    in: [string, unknown][];
    lt: [string, unknown][];
    gt: [string, unknown][];
    neq: [string, unknown][];
  };
};

/** Métodos del query builder que devuelven el mismo builder. */
const CHAINABLE = [
  "select",
  "insert",
  "update",
  "delete",
  "eq",
  "neq",
  "in",
  "lt",
  "lte",
  "gt",
  "gte",
  "is",
  "like",
  "ilike",
  "or",
  "order",
  "limit",
  "range",
] as const;

/** Métodos que cierran la cadena y resuelven al resultado. */
const TERMINAL = ["single", "maybeSingle", "csv"] as const;

export type SupabaseMock = {
  /** Se pasa a las funciones bajo prueba en lugar del cliente real. */
  client: never;
  /** Toda query construida, en orden. */
  queries: RecordedQuery[];
  /** La última query de una tabla, que es lo que casi siempre se quiere afirmar. */
  lastQuery(table: string): RecordedQuery;
};

/**
 * @param results Resultado por tabla. Si es un array, se consume como cola: una
 *   entrada por cada `.from(tabla)`, para las funciones que consultan la misma
 *   tabla más de una vez.
 */
export function createSupabaseMock(
  results: Record<string, MockResult | MockResult[]>,
): SupabaseMock {
  const queries: RecordedQuery[] = [];
  const queues = new Map<string, MockResult[]>();

  for (const [table, value] of Object.entries(results)) {
    queues.set(table, Array.isArray(value) ? [...value] : [value]);
  }

  function nextResult(table: string): MockResult {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      throw new Error(
        `El mock no tiene resultado para la tabla "${table}". ` +
          "Agregalo a `createSupabaseMock({ ... })`.",
      );
    }
    // La última entrada se reutiliza: así un test que no le importa cuántas
    // veces se consulta una tabla no tiene que contar los llamados.
    return queue.length === 1 ? queue[0]! : queue.shift()!;
  }

  const client = {
    from(table: string) {
      const record: RecordedQuery = {
        table,
        columns: "",
        ops: [],
        filters: { eq: [], in: [], lt: [], gt: [], neq: [] },
      };
      queries.push(record);

      const resolved = () => {
        const result = nextResult(table);
        return Promise.resolve({
          data: result.data ?? null,
          error: result.error ?? null,
          count: result.count ?? null,
        });
      };

      const builder: Record<string, unknown> = {};

      for (const name of CHAINABLE) {
        builder[name] = (...args: unknown[]) => {
          record.ops.push({ name, args });
          if (name === "select") record.columns = String(args[0] ?? "");
          if (name in record.filters && args.length >= 2) {
            (record.filters as Record<string, [string, unknown][]>)[name]!.push([
              String(args[0]),
              args[1],
            ]);
          }
          return builder;
        };
      }

      for (const name of TERMINAL) {
        builder[name] = (...args: unknown[]) => {
          record.ops.push({ name, args });
          return resolved();
        };
      }

      // `await query` sin método terminal: el builder de Supabase es thenable.
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => resolved().then(onFulfilled, onRejected);

      return builder;
    },
  };

  return {
    client: client as never,
    queries,
    lastQuery(table: string) {
      const found = [...queries].reverse().find((query) => query.table === table);
      if (!found) throw new Error(`No se consultó la tabla "${table}".`);
      return found;
    },
  };
}
