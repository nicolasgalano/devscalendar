import { describe, expect, it } from "vitest";

import {
  buildStartPayload,
  type TimerStartFormState,
} from "@/components/time-entries/timer-start-payload";

/**
 * 027 — Builder puro del body POST a `/api/time-entries/timer/start`.
 */

const PROJECT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TICKET_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTIVITY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function state(partial: Partial<TimerStartFormState> = {}): TimerStartFormState {
  return {
    projectId: null,
    activityId: null,
    ticketId: null,
    ...partial,
  };
}

describe("027 TimerStartDialog — buildStartPayload", () => {
  it("sin projectId → null (nunca mandar un POST que el server va a rebotar)", () => {
    expect(buildStartPayload(state())).toBeNull();
    expect(buildStartPayload(state({ activityId: ACTIVITY_ID }))).toBeNull();
    expect(buildStartPayload(state({ ticketId: TICKET_ID }))).toBeNull();
  });

  it("solo project → payload con ticket + activity null", () => {
    expect(buildStartPayload(state({ projectId: PROJECT_ID }))).toEqual({
      project_id: PROJECT_ID,
      ticket_id: null,
      activity_id: null,
    });
  });

  it("project + activity → payload con ticket null", () => {
    expect(
      buildStartPayload(state({ projectId: PROJECT_ID, activityId: ACTIVITY_ID })),
    ).toEqual({
      project_id: PROJECT_ID,
      ticket_id: null,
      activity_id: ACTIVITY_ID,
    });
  });

  it("project + ticket → payload con activity null", () => {
    expect(
      buildStartPayload(state({ projectId: PROJECT_ID, ticketId: TICKET_ID })),
    ).toEqual({
      project_id: PROJECT_ID,
      ticket_id: TICKET_ID,
      activity_id: null,
    });
  });

  it("project + activity + ticket → payload completo", () => {
    expect(
      buildStartPayload(
        state({
          projectId: PROJECT_ID,
          activityId: ACTIVITY_ID,
          ticketId: TICKET_ID,
        }),
      ),
    ).toEqual({
      project_id: PROJECT_ID,
      ticket_id: TICKET_ID,
      activity_id: ACTIVITY_ID,
    });
  });

  it("el payload siempre tiene las 3 keys (consistente para el server)", () => {
    const payload = buildStartPayload(state({ projectId: PROJECT_ID }));
    expect(payload).not.toBeNull();
    expect(Object.keys(payload!).sort()).toEqual([
      "activity_id",
      "project_id",
      "ticket_id",
    ]);
  });
});
