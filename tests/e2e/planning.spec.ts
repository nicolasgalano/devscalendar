import { expect, test } from "@playwright/test";

import {
  authenticate,
  createProjectFor,
  createUser,
  deleteProjectFixture,
  deleteUser,
  seedBooking,
  type TestUser,
} from "./session";
import { escapeForRegExp, testName } from "../run-id";

/**
 * `011` — the planning grid.
 *
 * Anchored to a **fixed** window instead of the current week, unlike
 * `calendar.spec.ts`: this view has to show holidays as non-working columns
 * (AC-1.4) and holidays are sparse, so a window that followed the clock would
 * exercise that assertion a few weeks a year. December 2026 puts Christmas on a
 * Friday inside a four-week window starting Monday 21/12, and both 2026 and
 * 2027 are loaded in `workdays.ts`, so the window never reaches a year without
 * holiday data.
 */
const MONDAY = "2026-12-21";
const WORKDAY = "2026-12-22"; // martes común
const HOLIDAY = "2026-12-25"; // Navidad, viernes
const LAST_DAY = "2027-01-17"; // día 28 de la ventana

/** Wall clock in Buenos Aires (UTC-3) as the UTC instant the database stores. */
const at = (isoDate: string, hour: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + (hour + 3) * 3_600_000).toISOString();

let pm: TestUser;
let dev: TestUser;
let alfa: { clientId: string; projectId: string };
let beta: { clientId: string; projectId: string };

const stamp = Date.now();
const alfaClientName = testName(`PL cliente Alfa ${stamp}`);
const betaClientName = testName(`PL cliente Beta ${stamp}`);
const alfaProjectName = testName(`PL proyecto Alfa ${stamp}`);
const betaProjectName = testName(`PL proyecto Beta ${stamp}`);

/** The cell of a given day, located by the accessible name the cell carries. */
const cellOn = (isoDate: string) =>
  new RegExp(`^${escapeForRegExp(dev.fullName)}, ${Number(isoDate.slice(8, 10))}/12`);

test.beforeAll(async () => {
  pm = await createUser("pm");
  dev = await createUser("developer");

  alfa = await createProjectFor(pm.userId, { client: alfaClientName, project: alfaProjectName });
  beta = await createProjectFor(pm.userId, { client: betaClientName, project: betaProjectName });

  // Five hours on each project, back to back. Neither is an overload on its
  // own; together they are ten. That is the shape R-1 is about — the hours that
  // overload someone live in a project a filter can hide.
  await seedBooking({
    projectId: alfa.projectId,
    devId: dev.userId,
    startsAt: at(WORKDAY, 9),
    endsAt: at(WORKDAY, 14),
  });
  await seedBooking({
    projectId: beta.projectId,
    devId: dev.userId,
    startsAt: at(WORKDAY, 14),
    endsAt: at(WORKDAY, 19),
    status: "pending",
  });
  // Christmas: booking outside the workday is allowed (Q-G), so the hours show
  // over the muted column instead of disappearing.
  await seedBooking({
    projectId: alfa.projectId,
    devId: dev.userId,
    startsAt: at(HOLIDAY, 10),
    endsAt: at(HOLIDAY, 14),
  });
});

test.afterAll(async () => {
  await deleteProjectFixture(alfa);
  await deleteProjectFixture(beta);
  await deleteUser(dev.userId);
  await deleteUser(pm.userId);
});

test.beforeEach(async ({ context }) => {
  await authenticate(context, pm);
});

// AC-1.1, AC-1.3, AC-5.2
test("shows four weeks anchored on the Monday of the week", async ({ page }) => {
  // A Wednesday: the window still has to open on its Monday.
  await page.goto("/calendar?view=planning&date=2026-12-23");

  await expect(page.locator("[data-planning-day]")).toHaveCount(28);
  await expect(page.locator(`[data-planning-day="${MONDAY}"]`)).toBeVisible();
  await expect(page.locator(`[data-planning-day="${LAST_DAY}"]`)).toBeVisible();

  // AC-5.2: the arrows move the whole window four weeks, not one.
  await page.getByRole("link", { name: "Período siguiente" }).click();
  await expect(page).toHaveURL(/date=2027-01-18/);
  await expect(page.locator(`[data-planning-day="${MONDAY}"]`)).toHaveCount(0);
});

// AC-1.2, AC-1.5
test("puts one row per client, project and developer, with the hours in the cell", async ({
  page,
}) => {
  await page.goto(`/calendar?view=planning&date=${MONDAY}`);

  const grid = page.locator("[data-planning-grid]");
  await expect(grid.getByText(alfaClientName)).toBeVisible();
  await expect(grid.getByText(betaClientName)).toBeVisible();
  await expect(grid.getByText(alfaProjectName)).toBeVisible();
  await expect(grid.getByText(betaProjectName)).toBeVisible();

  // Five hours on each project that day, not ten: the cell is per project.
  await expect(grid.getByRole("button", { name: cellOn(WORKDAY) })).toHaveCount(2);
  await expect(grid.getByRole("button", { name: cellOn(WORKDAY) }).first()).toContainText("5 h");
});

/**
 * AC-2.1 and AC-2.2 — the assertion the whole design of `plan.md` §5 exists
 * for. With the grid filtered to one client the developer still has to read as
 * overloaded, and the explanation has to **name the project the filter hid**.
 * If this passes after removing the second query, the query was never needed.
 */
test("keeps the overload explained when a filter hides the project causing it", async ({
  page,
}) => {
  await page.goto(`/calendar?view=planning&date=${MONDAY}&client=${alfa.clientId}`);

  const grid = page.locator("[data-planning-grid]");
  // The filter really is hiding the other client.
  await expect(grid.getByText(betaClientName)).toHaveCount(0);

  const cell = grid.getByRole("button", { name: cellOn(WORKDAY) });
  await expect(cell).toHaveCount(1);
  await expect(cell).toHaveAttribute("aria-label", /sobrecarga/);
  await cell.click();

  const popover = page.getByRole("dialog");
  await expect(popover).toContainText("Sobrecarga: 10 h");
  // The hidden project, named. This is the point.
  await expect(popover).toContainText(betaProjectName);
  // R-5: and its hours said out loud as not yet confirmed, so the 10 h can be
  // reconciled with the 5 h the filtered grid is showing.
  await expect(popover).toContainText("5 h pendientes");
});

// AC-4.1
test("opens a cell and links to its day with the filters intact", async ({ page }) => {
  await page.goto(`/calendar?view=planning&date=${MONDAY}&client=${alfa.clientId}`);

  await page
    .locator("[data-planning-grid]")
    .getByRole("button", { name: cellOn(WORKDAY) })
    .click();

  const popover = page.getByRole("dialog");
  await expect(popover).toContainText("09:00–14:00");
  await expect(popover).toContainText("Aprobada");

  await popover.getByRole("link", { name: "Ver el día en el calendario" }).click();
  await expect(page).toHaveURL(/view=day/);
  await expect(page).toHaveURL(new RegExp(`date=${WORKDAY}`));
  await expect(page).toHaveURL(new RegExp(`client=${alfa.clientId}`));
});

// AC-1.4 — a holiday is muted, and the work booked on it is still shown.
test("mutes a holiday column without hiding the work booked on it", async ({ page }) => {
  await page.goto(`/calendar?view=planning&date=${MONDAY}`);

  await expect(page.locator(`[data-planning-day="${HOLIDAY}"]`)).toHaveAttribute(
    "data-workday",
    "false",
  );
  await expect(page.locator(`[data-planning-day="${WORKDAY}"]`)).toHaveAttribute(
    "data-workday",
    "true",
  );

  const holidayCell = page
    .locator("[data-planning-grid]")
    .getByRole("button", { name: cellOn(HOLIDAY) });
  await expect(holidayCell).toHaveCount(1);
  await expect(holidayCell).toContainText("4 h");
});
