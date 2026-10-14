// 027. Helper puro del `<TimerStartDialog>` — construye el body del POST a
// `/api/time-entries/timer/start` desde el state del dialog. Separado en un
// archivo `.ts` para que los unit tests lo importen sin que vite procese el
// JSX del dialog completo.
//
// Contrato del endpoint (ver `startTimerSchema` en `lib/validation/time-entries.ts`):
//   project_id: string uuid
//   ticket_id?: string uuid | null
//   activity_id?: string uuid | null

export type TimerStartFormState = {
  projectId: string | null;
  activityId: string | null;
  ticketId: string | null;
};

export type TimerStartPayload = {
  project_id: string;
  ticket_id: string | null;
  activity_id: string | null;
};

// Devuelve el payload si el state tiene al menos `projectId`; si no, `null`.
// El handler del server valida de todas formas y rebota con 400 ante body
// inválido, pero cerramos acá para no mandar requests inútiles.
//
// Si el proyecto exige actividad (activity_required) y no se eligió, el server
// responde 400 con `reason: 'activity_required'` — eso se maneja en el UI al
// recibir la respuesta, no acá.
export function buildStartPayload(
  state: TimerStartFormState,
): TimerStartPayload | null {
  if (!state.projectId) return null;
  return {
    project_id: state.projectId,
    ticket_id: state.ticketId,
    activity_id: state.activityId,
  };
}
