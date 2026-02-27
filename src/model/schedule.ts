/**
 * Schedule computation — pure functions for the weekly schedule grid.
 *
 * Ported from: CalDavView.java lines 63-716 (constants, slot generation,
 * event filtering, overlap detection, priority, CSS class, labels, tooltips,
 * and the "All Free" summary row computation).
 *
 * All functions are pure — they take data in and return results without
 * side effects. This makes them easy to test and reason about.
 */

import type { CalDavUser, CalDavEvent, SlotInfo, ScheduleRow } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────
// Ported from CalDavView.java lines 69-84

/** Schedule start time (inclusive). */
export const SCHEDULE_START = "07:00";

/** Schedule end time (exclusive). */
export const SCHEDULE_END = "19:00";

/** Duration of each time slot in minutes. */
export const SLOT_MINUTES = 30;

/**
 * Weekday indices (0 = Monday, 4 = Friday).
 * Matches Java's DayOfWeek.MONDAY(0) through DayOfWeek.FRIDAY(4)
 * as used in the slot key format "dayIdx-HH:mm".
 */
export const WEEKDAY_COUNT = 5;

/** Short day names for display. */
export const DAY_SHORT_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// ─── Time Slot Generation ────────────────────────────────────────────────────

/**
 * Generates the list of time slot start times as "HH:mm" strings.
 * Returns ["07:00", "07:30", "08:00", ..., "18:30"].
 *
 * Ported from: CalDavView.java constructor lines 139-143
 */
export function generateTimeSlots(): string[] {
  const slots: string[] = [];
  let totalMinutes = parseTimeToMinutes(SCHEDULE_START);
  const endMinutes = parseTimeToMinutes(SCHEDULE_END);

  while (totalMinutes < endMinutes) {
    slots.push(formatMinutesToTime(totalMinutes));
    totalMinutes += SLOT_MINUTES;
  }

  return slots;
}

/**
 * Generates all slot keys used as column identifiers.
 * Format: "dayIdx-HH:mm", e.g. "0-07:00", "0-07:30", ..., "4-18:30".
 *
 * Ported from: CalDavView.java constructor lines 144-148
 */
export function generateSlotKeys(): string[] {
  const keys: string[] = [];
  const timeSlots = generateTimeSlots();

  for (let dayIdx = 0; dayIdx < WEEKDAY_COUNT; dayIdx++) {
    for (const time of timeSlots) {
      keys.push(`${dayIdx}-${time}`);
    }
  }

  return keys;
}

// ─── Event Filtering ─────────────────────────────────────────────────────────

/**
 * Filters events to those occurring on a specific day.
 *
 * Ported from: CalDavView.java filterEventsForDay() lines 604-608
 *
 * @param events  all events for the user in the current week
 * @param dayDate the date to filter by, as ISO string "YYYY-MM-DD"
 */
export function filterEventsForDay(
  events: CalDavEvent[],
  dayDate: string
): CalDavEvent[] {
  return events.filter((e) => e.date === dayDate);
}

/**
 * Finds events that overlap with the given time slot.
 *
 * A slot [slotStart, slotEnd) is overlapped by an event if:
 *   event.startTime < slotEnd AND event.endTime > slotStart
 * All-day events (null start/end times) overlap all slots.
 *
 * Ported from: CalDavView.java findOverlappingEvents() lines 616-628
 *
 * @param dayEvents events for a single day
 * @param slotStart slot start time as "HH:mm"
 * @param slotEnd   slot end time as "HH:mm"
 */
export function findOverlappingEvents(
  dayEvents: CalDavEvent[],
  slotStart: string,
  slotEnd: string
): CalDavEvent[] {
  return dayEvents.filter((event) => {
    // All-day events overlap every slot
    if (event.startTime === null || event.endTime === null) {
      return true;
    }
    // Standard overlap check: event.start < slotEnd && event.end > slotStart
    return event.startTime < slotEnd && event.endTime > slotStart;
  });
}

// ─── Event Priority & Selection ──────────────────────────────────────────────

/**
 * Returns a numeric priority for an event based on its status.
 * Higher values = more significant.
 *
 * Ported from: CalDavView.java eventPriority() lines 647-654
 */
export function eventPriority(event: CalDavEvent): number {
  switch (event.status) {
    case "BUSY-UNAVAILABLE":
      return 3;
    case "BUSY":
      return 2;
    case "BUSY-TENTATIVE":
      return 1;
    default:
      // PUBLIC, PRIVATE, CONFIDENTIAL from calendar-query are treated as BUSY
      return 2;
  }
}

/**
 * Selects the most "significant" event for display when multiple events
 * overlap a slot. Priority: BUSY-UNAVAILABLE > BUSY > BUSY-TENTATIVE > other.
 * Among equal priority, prefers accessible events (which have details).
 *
 * Ported from: CalDavView.java selectPrimaryEvent() lines 635-645
 */
export function selectPrimaryEvent(events: CalDavEvent[]): CalDavEvent {
  let best = events[0];
  for (const event of events) {
    if (eventPriority(event) > eventPriority(best)) {
      best = event;
    } else if (
      eventPriority(event) === eventPriority(best) &&
      event.accessible &&
      !best.accessible
    ) {
      best = event;
    }
  }
  return best;
}

// ─── CSS Class & Label ───────────────────────────────────────────────────────

/**
 * Determines the CSS class for a slot based on the primary event.
 *
 * Ported from: CalDavView.java getCssClassForEvent() lines 659-670
 */
export function getCssClassForEvent(event: CalDavEvent): string {
  if (event.accessible) {
    // Full calendar access - blue
    return "slot-busy";
  }
  // Free-busy only - color based on FBTYPE
  switch (event.status) {
    case "BUSY-TENTATIVE":
      return "slot-busy-tentative";
    case "BUSY-UNAVAILABLE":
      return "slot-busy-unavailable";
    default:
      return "slot-busy-fb";
  }
}

/**
 * Returns a short label for a slot cell. Shows the event summary
 * (truncated) for accessible events, or null for free-busy only.
 *
 * Ported from: CalDavView.java getSlotLabel() lines 676-682
 */
export function getSlotLabel(event: CalDavEvent): string | null {
  if (event.accessible && event.summary !== null) {
    const summary = event.summary;
    return summary.length > 8 ? summary.substring(0, 7) + "\u2026" : summary;
  }
  return null;
}

/**
 * Builds a tooltip string listing all overlapping events in a slot.
 * Shows event summaries and exact times for accessible events,
 * or just the busy type for free-busy-only events.
 *
 * Ported from: CalDavView.java buildTooltip() lines 689-716
 *
 * @param events    overlapping events for this slot
 * @param _slotStart slot start time (unused but kept for API parity)
 * @param _slotEnd   slot end time (unused but kept for API parity)
 */
export function buildTooltip(
  events: CalDavEvent[],
  _slotStart: string,
  _slotEnd: string
): string | null {
  if (events.length === 0) {
    return null;
  }

  const lines: string[] = [];
  for (const event of events) {
    if (event.accessible && event.summary !== null) {
      let line = event.summary;
      if (event.startTime !== null && event.endTime !== null) {
        line += ` (${formatTimeForDisplay(event.startTime)} - ${formatTimeForDisplay(event.endTime)})`;
      }
      lines.push(line);
    } else {
      // Free-busy only
      let line = event.status;
      if (event.startTime !== null && event.endTime !== null) {
        line += ` (${formatTimeForDisplay(event.startTime)} - ${formatTimeForDisplay(event.endTime)})`;
      }
      lines.push(line);
    }
  }

  return lines.join("\n");
}

// ─── Slot Computation ────────────────────────────────────────────────────────

/**
 * Computes slot statuses for a single user based on their events.
 *
 * Ported from: CalDavView.java computeUserSlots() lines 538-576
 *
 * @param events     events for the user in the current week
 * @param weekStart  the Monday of the displayed week as ISO date "YYYY-MM-DD"
 * @param hasFailed  whether the event fetch failed for this user
 */
export function computeUserSlots(
  events: CalDavEvent[],
  weekStart: string,
  hasFailed: boolean
): Record<string, SlotInfo> {
  const slots: Record<string, SlotInfo> = {};
  const timeSlots = generateTimeSlots();

  for (let dayIdx = 0; dayIdx < WEEKDAY_COUNT; dayIdx++) {
    const dayDate = addDays(weekStart, dayIdx);

    // Get events for this day
    const dayEvents = filterEventsForDay(events, dayDate);

    for (const time of timeSlots) {
      const key = `${dayIdx}-${time}`;
      const slotEnd = addMinutesToTime(time, SLOT_MINUTES);

      if (hasFailed) {
        slots[key] = {
          cssClass: "schedule-error-cell",
          label: "?",
          tooltip: "Failed to load",
          busy: true,
        };
        continue;
      }

      // Find events that overlap with this slot
      const overlapping = findOverlappingEvents(dayEvents, time, slotEnd);

      if (overlapping.length === 0) {
        // Free slot
        slots[key] = { cssClass: "", label: null, tooltip: null, busy: false };
      } else {
        // Busy slot - determine the most significant event for display
        const primaryEvent = selectPrimaryEvent(overlapping);
        const cssClass = getCssClassForEvent(primaryEvent);
        const label = getSlotLabel(primaryEvent);
        const tooltip = buildTooltip(overlapping, time, slotEnd);

        slots[key] = { cssClass, label, tooltip, busy: true };
      }
    }
  }

  return slots;
}

/**
 * Computes the "All Free" row slots based on all user rows.
 * For each slot key: if no user row has busy=true, the slot is "all free".
 *
 * Ported from: CalDavView.java computeAllFreeSlots() lines 581-599
 */
export function computeAllFreeSlots(
  userRows: ScheduleRow[]
): Record<string, SlotInfo> {
  const slots: Record<string, SlotInfo> = {};
  const slotKeys = generateSlotKeys();

  for (const key of slotKeys) {
    const allFree = userRows.every((row) => {
      const slot = row.slots[key];
      return slot === undefined || !slot.busy;
    });

    if (allFree) {
      slots[key] = {
        cssClass: "slot-all-free",
        label: null,
        tooltip: "All users are free",
        busy: false,
      };
    } else {
      slots[key] = {
        cssClass: "slot-not-all-free",
        label: null,
        tooltip: null,
        busy: true,
      };
    }
  }

  return slots;
}

/**
 * Builds the list of schedule rows: one per user + the "All Free" summary row.
 *
 * Ported from: CalDavView.java buildScheduleRows() lines 518-533
 *
 * @param selectedUsers  ordered list of selected users
 * @param userEvents     map of user href to events for the current week
 * @param failedUsers    set of user hrefs whose fetch failed
 * @param weekStart      Monday of the displayed week as ISO date "YYYY-MM-DD"
 */
export function buildScheduleRows(
  selectedUsers: CalDavUser[],
  userEvents: Map<string, CalDavEvent[]>,
  failedUsers: Set<string>,
  weekStart: string
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];

  // One row per user
  for (const user of selectedUsers) {
    const events = userEvents.get(user.href) ?? [];
    const hasFailed = failedUsers.has(user.href);
    const slots = computeUserSlots(events, weekStart, hasFailed);
    rows.push({ user, slots });
  }

  // "All Free" summary row
  const allFreeSlots = computeAllFreeSlots(rows);
  rows.push({ user: null, slots: allFreeSlots });

  return rows;
}

// ─── Date/Time Helpers ───────────────────────────────────────────────────────
// Small utility functions for time arithmetic using "HH:mm" strings and
// "YYYY-MM-DD" date strings. Avoids the complexity of Date objects.

/**
 * Parses a "HH:mm" time string into total minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Formats total minutes since midnight into a "HH:mm" string.
 * Uses leading zeros consistently (e.g. "07:00").
 */
function formatMinutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Adds minutes to an "HH:mm" time and returns the resulting "HH:mm" string.
 */
function addMinutesToTime(time: string, minutesToAdd: number): string {
  return formatMinutesToTime(parseTimeToMinutes(time) + minutesToAdd);
}

/**
 * Adds days to an ISO date string "YYYY-MM-DD" and returns the result
 * as an ISO date string.
 */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return (
    date.getUTCFullYear().toString() +
    "-" +
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getUTCDate()).padStart(2, "0")
  );
}

/**
 * Formats an "HH:mm" time string for display purposes.
 * Strips the leading zero from the hour to match the Java TIME_FORMATTER
 * pattern "H:mm" (e.g. "07:00" -> "7:00", "14:30" -> "14:30").
 *
 * Ported from: CalDavView.java TIME_FORMATTER = DateTimeFormatter.ofPattern("H:mm")
 */
export function formatTimeForDisplay(time: string): string {
  if (time.startsWith("0")) {
    return time.substring(1);
  }
  return time;
}

/**
 * Returns the Monday of the week containing the given date (or today if
 * no date is provided). Returns an ISO date string "YYYY-MM-DD".
 *
 * Ported from: CalDavView.java line 151 — LocalDate.now().with(previousOrSame(MONDAY))
 */
export function getMondayOfWeek(date?: Date): string {
  const d = date ? new Date(date) : new Date();
  // getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  const dayOfWeek = d.getDay();
  // Calculate offset to Monday: Sun(0)->-6, Mon(1)->0, Tue(2)->-1, ..., Sat(6)->-5
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + offset);

  return (
    d.getFullYear().toString() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * Formats a week range for display: "Feb 10 - Feb 14, 2025".
 *
 * Ported from: CalDavView.java updateWeekLabel() lines 307-312
 *
 * @param weekStart Monday of the week as ISO date "YYYY-MM-DD"
 */
export function formatWeekLabel(weekStart: string): string {
  const monday = new Date(weekStart + "T00:00:00Z");
  const friday = new Date(monday);
  friday.setUTCDate(friday.getUTCDate() + 4);

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const monMonth = monthNames[monday.getUTCMonth()];
  const monDay = monday.getUTCDate();
  const friMonth = monthNames[friday.getUTCMonth()];
  const friDay = friday.getUTCDate();
  const year = monday.getUTCFullYear();

  return `${monMonth} ${monDay} - ${friMonth} ${friDay}, ${year}`;
}

/**
 * Returns the date string for a specific weekday within the given week.
 *
 * @param weekStart Monday of the week as ISO date "YYYY-MM-DD"
 * @param dayIdx    weekday index (0=Mon, 1=Tue, ..., 4=Fri)
 */
export function getWeekdayDate(weekStart: string, dayIdx: number): string {
  return addDays(weekStart, dayIdx);
}

/**
 * Formats a date string for display as day header: "Mon Feb 10".
 *
 * @param weekStart Monday of the week as ISO date "YYYY-MM-DD"
 * @param dayIdx    weekday index (0=Mon, ..., 4=Fri)
 */
export function formatDayHeader(weekStart: string, dayIdx: number): string {
  const dateStr = addDays(weekStart, dayIdx);
  const date = new Date(dateStr + "T00:00:00Z");

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return `${DAY_SHORT_NAMES[dayIdx]} ${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;
}
