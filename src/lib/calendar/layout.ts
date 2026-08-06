import { MINUTES_PER_ROW, type DayWindow } from "./range";

export type TimeSpan = { startsAt: string; endsAt: string };

/** 1-based CSS grid lines, ready for `grid-row: start / end`. */
export type GridRows = { rowStart: number; rowEnd: number };

/**
 * Maps a booking onto the 30-minute rows of the day grid.
 *
 * `startMinute`/`endMinute` are minutes from local midnight and must already be
 * clamped to the day (see `visibleDayWindow`). A booking shorter than one row
 * still occupies a full row: a 15-minute block collapsed to zero height would
 * be invisible and unclickable.
 */
export function toGridRows(
  { startMinute, endMinute }: { startMinute: number; endMinute: number },
  window: DayWindow,
): GridRows {
  const clampedStart = Math.max(startMinute, window.startMinute);
  const clampedEnd = Math.min(endMinute, window.endMinute);

  const rowStart = Math.floor((clampedStart - window.startMinute) / MINUTES_PER_ROW) + 1;
  const rowEnd = Math.ceil((clampedEnd - window.startMinute) / MINUTES_PER_ROW) + 1;

  return { rowStart, rowEnd: Math.max(rowEnd, rowStart + 1) };
}

export function rowCount(window: DayWindow): number {
  return (window.endMinute - window.startMinute) / MINUTES_PER_ROW;
}

export type Positioned<T> = {
  item: T;
  /** 0-based position within its overlap cluster. */
  column: number;
  /** Total columns in that cluster — every member shares this width. */
  columns: number;
};

/**
 * Splits overlapping bookings of a single lane into side-by-side columns.
 *
 * Works per *cluster* (a maximal chain of bookings connected by overlap) rather
 * than per pair. The naive "count how many bookings each one overlaps"
 * approach breaks on a chain: with A 09:00–10:00, B 09:30–10:30 and C
 * 10:00–11:00, A and C never overlap each other but both overlap B, so a
 * per-item count yields widths of 2, 3 and 2 — three different column grids
 * inside one visual group, and blocks that don't line up.
 *
 * Here the whole chain shares one width (2), and C reuses A's column because A
 * already ended.
 */
export function assignColumns<T extends TimeSpan>(items: readonly T[]): Positioned<T>[] {
  const sorted = [...items].sort((a, b) => {
    const byStart = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    if (byStart !== 0) return byStart;
    // Longest first on ties, so the block that spans the cluster takes the
    // leftmost column and the short ones stack to its right.
    return Date.parse(b.endsAt) - Date.parse(a.endsAt);
  });

  const positioned: Positioned<T>[] = [];
  let cluster: Positioned<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const entry of cluster) entry.columns = columnEnds.length;
    positioned.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);

    if (start >= clusterEnd && cluster.length > 0) flush();

    // First column already free at `start`; a new one only when all are busy.
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }

    cluster.push({ item, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }

  if (cluster.length > 0) flush();

  return positioned;
}

/** Groups bookings into lanes (one per developer or per project). */
export function groupIntoLanes<T>(
  items: readonly T[],
  keyOf: (item: T) => { id: string; name: string },
): { id: string; name: string; items: T[] }[] {
  const lanes = new Map<string, { id: string; name: string; items: T[] }>();

  for (const item of items) {
    const { id, name } = keyOf(item);
    const lane = lanes.get(id);
    if (lane) lane.items.push(item);
    else lanes.set(id, { id, name, items: [item] });
  }

  return [...lanes.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
