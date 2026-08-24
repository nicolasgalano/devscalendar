/**
 * Lee el body de un request sin confiar en que sea JSON.
 *
 * `request.json()` **tira** ante un body vacío o mal formado, y sin atajarlo esa
 * excepción sale como un 500 con stack trace en la consola: un cliente que manda
 * basura queda registrado como una falla del servidor, y el que la lee sale a
 * buscar un bug que no existe. Devolver `undefined` deja que el schema de Zod lo
 * rechace como cualquier otro payload inválido, con el mismo 400 de siempre.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
