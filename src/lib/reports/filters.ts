/**
 * Filtros comunes de los reportes de 016. Todo vive en la URL (patrón del
 * calendario y del backlog); el parser nunca tira.
 *
 * Rango default: mes calendario actual. Filtros vacíos: sin restricción.
 */
export type ReportFilters = {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  clientId: string | null;
  projectId: string | null;
  userId: string | null;
};

const UUID_RX = /^[0-9a-f-]{36}$/i;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Primer y último día del mes actual como ISO strings (en UTC — se trata
 * como fecha calendario, sin zona).
 */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

export function parseReportFilters(
  raw: Record<string, string | string[] | undefined>,
): ReportFilters {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const rawFrom = first(raw.from);
  const rawTo = first(raw.to);
  const defaults = currentMonthRange();
  const from = rawFrom && DATE_RX.test(rawFrom) ? rawFrom : defaults.from;
  const to = rawTo && DATE_RX.test(rawTo) ? rawTo : defaults.to;

  const clientId = first(raw.clientId);
  const projectId = first(raw.projectId);
  const userId = first(raw.userId);

  return {
    from,
    to: to < from ? from : to, // saneo defensivo
    clientId: clientId && UUID_RX.test(clientId) ? clientId : null,
    projectId: projectId && UUID_RX.test(projectId) ? projectId : null,
    userId: userId && UUID_RX.test(userId) ? userId : null,
  };
}

export function buildReportHref(
  basePath: string,
  current: ReportFilters,
  patch: Partial<ReportFilters>,
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  const defaults = currentMonthRange();
  if (next.from !== defaults.from) params.set("from", next.from);
  if (next.to !== defaults.to) params.set("to", next.to);
  if (next.clientId) params.set("clientId", next.clientId);
  if (next.projectId) params.set("projectId", next.projectId);
  if (next.userId) params.set("userId", next.userId);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
