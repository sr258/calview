/**
 * Schedule computation tests — NEW tests (no Java equivalent).
 *
 * Tests cover all pure functions in schedule.ts:
 * - Time slot generation
 * - Event filtering
 * - Overlap detection
 * - Event priority & selection
 * - CSS class mapping
 * - Slot labels
 * - Event key generation
 * - Tooltips
 * - Full slot computation
 * - Cell merging (colSpan)
 * - "All Free" computation
 * - Date/time helpers
 */

import { describe, it, expect } from "vitest";
import type { CalDavEvent, CalDavUser, ScheduleRow } from "./types.js";
import {
  SCHEDULE_START,
  SCHEDULE_END,
  SLOT_MINUTES,
  WEEKDAY_COUNT,
  DAY_SHORT_NAMES,
  generateTimeSlots,
  generateSlotKeys,
  filterEventsForDay,
  findOverlappingEvents,
  eventPriority,
  selectPrimaryEvent,
  getCssClassForEvent,
  getSlotLabel,
  getEventKey,
  buildTooltip,
  computeUserSlots,
  computeMergedCells,
  computeAllFreeSlots,
  buildScheduleRows,
  addDays,
  formatTimeForDisplay,
  getMondayOfWeek,
  formatWeekLabel,
  getWeekdayDate,
  formatDayHeader,
  layoutOverlappingEvents,
  buildPositionedEventsForDay,
  generateHourLabels,
  timeToPixels,
  HOUR_HEIGHT_PX,
} from "./schedule.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CalDavEvent> = {}): CalDavEvent {
  return {
    summary: "Test Event",
    date: "2025-02-10",
    startTime: "10:00",
    endTime: "11:00",
    status: "PUBLIC",
    accessible: true,
    ...overrides,
  };
}

function makeUser(name: string, href: string): CalDavUser {
  return { displayName: name, href };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe("constants", () => {
  it("has correct schedule boundaries", () => {
    expect(SCHEDULE_START).toBe("07:00");
    expect(SCHEDULE_END).toBe("19:00");
    expect(SLOT_MINUTES).toBe(5);
    expect(WEEKDAY_COUNT).toBe(5);
  });

  it("has correct day short names", () => {
    expect(DAY_SHORT_NAMES).toEqual(["Mo", "Di", "Mi", "Do", "Fr"]);
  });
});

// ─── Time Slot Generation ────────────────────────────────────────────────────

describe("generateTimeSlots", () => {
  it("generates correct time slots from 07:00 to 18:55", () => {
    const slots = generateTimeSlots();

    expect(slots[0]).toBe("07:00");
    expect(slots[1]).toBe("07:05");
    expect(slots[slots.length - 1]).toBe("18:55");

    // 07:00 to 19:00 = 12 hours = 720 minutes / 5 = 144 slots
    expect(slots).toHaveLength(144);
  });

  it("has consistent 5-minute increments", () => {
    const slots = generateTimeSlots();
    for (let i = 1; i < slots.length; i++) {
      const [prevH, prevM] = slots[i - 1].split(":").map(Number);
      const [currH, currM] = slots[i].split(":").map(Number);
      const diffMinutes = (currH * 60 + currM) - (prevH * 60 + prevM);
      expect(diffMinutes).toBe(5);
    }
  });
});

describe("generateSlotKeys", () => {
  it("generates keys for all weekdays and time slots", () => {
    const keys = generateSlotKeys();
    // 5 days * 144 slots = 720 keys
    expect(keys).toHaveLength(720);
  });

  it("has correct format dayIdx-HH:mm", () => {
    const keys = generateSlotKeys();
    expect(keys[0]).toBe("0-07:00");
    expect(keys[1]).toBe("0-07:05");
    expect(keys[143]).toBe("0-18:55");
    expect(keys[144]).toBe("1-07:00");
    expect(keys[719]).toBe("4-18:55");
  });
});

// ─── Event Filtering ─────────────────────────────────────────────────────────

describe("filterEventsForDay", () => {
  it("filters events by date", () => {
    const events = [
      makeEvent({ date: "2025-02-10" }),
      makeEvent({ date: "2025-02-11" }),
      makeEvent({ date: "2025-02-10" }),
    ];

    const filtered = filterEventsForDay(events, "2025-02-10");

    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.date === "2025-02-10")).toBe(true);
  });

  it("returns empty array when no events match", () => {
    const events = [makeEvent({ date: "2025-02-10" })];

    const filtered = filterEventsForDay(events, "2025-02-11");

    expect(filtered).toHaveLength(0);
  });
});

// ─── Overlap Detection ───────────────────────────────────────────────────────

describe("findOverlappingEvents", () => {
  it("finds events that overlap with a slot", () => {
    const events = [
      makeEvent({ startTime: "09:30", endTime: "10:30" }), // overlaps 10:00-10:05
      makeEvent({ startTime: "11:00", endTime: "12:00" }), // does not overlap
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:05");

    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].startTime).toBe("09:30");
  });

  it("all-day events overlap every slot", () => {
    const events = [
      makeEvent({ startTime: null, endTime: null }), // all-day
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:05");

    expect(overlapping).toHaveLength(1);
  });

  it("event ending at slot start does not overlap", () => {
    const events = [
      makeEvent({ startTime: "09:00", endTime: "10:00" }),
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:05");

    expect(overlapping).toHaveLength(0);
  });

  it("event starting at slot end does not overlap", () => {
    const events = [
      makeEvent({ startTime: "10:05", endTime: "11:00" }),
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:05");

    expect(overlapping).toHaveLength(0);
  });

  it("finds multiple overlapping events", () => {
    const events = [
      makeEvent({ startTime: "09:00", endTime: "10:30" }),
      makeEvent({ startTime: "10:00", endTime: "11:00" }),
      makeEvent({ startTime: "10:02", endTime: "10:45" }),
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:05");

    expect(overlapping).toHaveLength(3);
  });
});

// ─── Event Priority ──────────────────────────────────────────────────────────

describe("eventPriority", () => {
  it("BUSY-UNAVAILABLE has highest priority (3)", () => {
    expect(eventPriority(makeEvent({ status: "BUSY-UNAVAILABLE" }))).toBe(3);
  });

  it("BUSY has priority 2", () => {
    expect(eventPriority(makeEvent({ status: "BUSY" }))).toBe(2);
  });

  it("BUSY-TENTATIVE has priority 1", () => {
    expect(eventPriority(makeEvent({ status: "BUSY-TENTATIVE" }))).toBe(1);
  });

  it("PUBLIC/PRIVATE/other defaults to priority 2", () => {
    expect(eventPriority(makeEvent({ status: "PUBLIC" }))).toBe(2);
    expect(eventPriority(makeEvent({ status: "PRIVATE" }))).toBe(2);
    expect(eventPriority(makeEvent({ status: "CONFIDENTIAL" }))).toBe(2);
  });
});

// ─── Event Selection ─────────────────────────────────────────────────────────

describe("selectPrimaryEvent", () => {
  it("selects highest priority event", () => {
    const events = [
      makeEvent({ status: "BUSY-TENTATIVE", summary: "Tentative" }),
      makeEvent({ status: "BUSY-UNAVAILABLE", summary: "Unavailable" }),
      makeEvent({ status: "BUSY", summary: "Busy" }),
    ];

    const primary = selectPrimaryEvent(events);

    expect(primary.summary).toBe("Unavailable");
  });

  it("prefers accessible event at same priority", () => {
    const events = [
      makeEvent({ status: "BUSY", accessible: false, summary: null }),
      makeEvent({ status: "BUSY", accessible: true, summary: "Accessible" }),
    ];

    const primary = selectPrimaryEvent(events);

    expect(primary.accessible).toBe(true);
    expect(primary.summary).toBe("Accessible");
  });
});

// ─── CSS Class ───────────────────────────────────────────────────────────────

describe("getCssClassForEvent", () => {
  it("returns 'slot-busy' for accessible events", () => {
    expect(getCssClassForEvent(makeEvent({ accessible: true }))).toBe(
      "slot-busy"
    );
  });

  it("returns 'slot-busy-tentative' for BUSY-TENTATIVE free-busy", () => {
    expect(
      getCssClassForEvent(
        makeEvent({ accessible: false, status: "BUSY-TENTATIVE" })
      )
    ).toBe("slot-busy-tentative");
  });

  it("returns 'slot-busy-unavailable' for BUSY-UNAVAILABLE free-busy", () => {
    expect(
      getCssClassForEvent(
        makeEvent({ accessible: false, status: "BUSY-UNAVAILABLE" })
      )
    ).toBe("slot-busy-unavailable");
  });

  it("returns 'slot-busy-fb' for BUSY free-busy", () => {
    expect(
      getCssClassForEvent(makeEvent({ accessible: false, status: "BUSY" }))
    ).toBe("slot-busy-fb");
  });
});

// ─── Slot Labels ─────────────────────────────────────────────────────────────

describe("getSlotLabel", () => {
  it("returns truncated summary for accessible events (default colSpan)", () => {
    expect(getSlotLabel(makeEvent({ summary: "Long Event Name" }))).toBe(
      "Long Ev\u2026"
    );
  });

  it("returns full summary if 8 chars or less", () => {
    expect(getSlotLabel(makeEvent({ summary: "Short" }))).toBe("Short");
    expect(getSlotLabel(makeEvent({ summary: "12345678" }))).toBe("12345678");
  });

  it("returns null for non-accessible events", () => {
    expect(
      getSlotLabel(makeEvent({ accessible: false, summary: null }))
    ).toBeNull();
  });

  it("returns null when summary is null", () => {
    expect(getSlotLabel(makeEvent({ summary: null }))).toBeNull();
  });

  it("allows longer labels with larger colSpan", () => {
    // colSpan=12 (1 hour at 5-min slots) => 12*5/6 = 10 chars max
    const label = getSlotLabel(
      makeEvent({ summary: "A Very Long Meeting Name" }),
      12
    );
    // 10 chars max → 9 chars + ellipsis
    expect(label).toBe("A Very Lo\u2026");
  });
});

// ─── Event Key ───────────────────────────────────────────────────────────────

describe("getEventKey", () => {
  it("returns a composite string key", () => {
    const event = makeEvent({
      date: "2025-02-10",
      startTime: "10:00",
      endTime: "11:00",
      summary: "Meeting",
      status: "PUBLIC",
      accessible: true,
    });

    const key = getEventKey(event);

    expect(key).toBe("2025-02-10|10:00|11:00|Meeting|PUBLIC|true");
  });

  it("produces different keys for different events", () => {
    const event1 = makeEvent({ summary: "Meeting A" });
    const event2 = makeEvent({ summary: "Meeting B" });

    expect(getEventKey(event1)).not.toBe(getEventKey(event2));
  });

  it("produces same key for identical events", () => {
    const event1 = makeEvent();
    const event2 = makeEvent();

    expect(getEventKey(event1)).toBe(getEventKey(event2));
  });

  it("handles null start/end times (all-day events)", () => {
    const event = makeEvent({ startTime: null, endTime: null });
    const key = getEventKey(event);

    expect(key).toContain("|null|null|");
  });
});

// ─── Tooltips ────────────────────────────────────────────────────────────────

describe("buildTooltip", () => {
  it("returns null for empty events", () => {
    expect(buildTooltip([], "10:00", "10:05")).toBeNull();
  });

  it("shows summary and time for accessible events", () => {
    const events = [
      makeEvent({ summary: "Meeting", startTime: "10:00", endTime: "11:00" }),
    ];

    const tooltip = buildTooltip(events, "10:00", "10:05");

    expect(tooltip).toBe("Meeting (10:00 - 11:00)");
  });

  it("shows status and time for non-accessible events", () => {
    const events = [
      makeEvent({
        accessible: false,
        summary: null,
        status: "BUSY",
        startTime: "10:00",
        endTime: "11:00",
      }),
    ];

    const tooltip = buildTooltip(events, "10:00", "10:05");

    expect(tooltip).toBe("BUSY (10:00 - 11:00)");
  });

  it("joins multiple events with newlines", () => {
    const events = [
      makeEvent({ summary: "Event A", startTime: "10:00", endTime: "10:30" }),
      makeEvent({ summary: "Event B", startTime: "10:00", endTime: "11:00" }),
    ];

    const tooltip = buildTooltip(events, "10:00", "10:05");

    expect(tooltip).toBe(
      "Event A (10:00 - 10:30)\nEvent B (10:00 - 11:00)"
    );
  });

  it("formats times without leading zeros", () => {
    const events = [
      makeEvent({ summary: "Early", startTime: "07:00", endTime: "08:30" }),
    ];

    const tooltip = buildTooltip(events, "07:00", "07:05");

    expect(tooltip).toBe("Early (7:00 - 8:30)");
  });
});

// ─── Full Slot Computation ───────────────────────────────────────────────────

describe("computeUserSlots", () => {
  it("marks free slots with empty cssClass", () => {
    // No events → all slots should be free
    const slots = computeUserSlots([], "2025-02-10", false);

    expect(slots["0-10:00"].cssClass).toBe("");
    expect(slots["0-10:00"].busy).toBe(false);
    expect(slots["0-10:00"].label).toBeNull();
    expect(slots["0-10:00"].eventKey).toBeNull();
  });

  it("marks busy slots with correct cssClass and eventKey", () => {
    const events = [
      makeEvent({
        date: "2025-02-10",
        startTime: "10:00",
        endTime: "11:00",
        accessible: true,
        summary: "Meeting",
      }),
    ];

    const slots = computeUserSlots(events, "2025-02-10", false);

    // 10:00 slot should be busy
    expect(slots["0-10:00"].cssClass).toBe("slot-busy");
    expect(slots["0-10:00"].busy).toBe(true);
    expect(slots["0-10:00"].label).toBe("Meeting");
    expect(slots["0-10:00"].eventKey).not.toBeNull();

    // 10:05 through 10:55 slots should also be busy (event goes 10:00-11:00)
    expect(slots["0-10:05"].cssClass).toBe("slot-busy");
    expect(slots["0-10:05"].busy).toBe(true);
    expect(slots["0-10:30"].cssClass).toBe("slot-busy");
    expect(slots["0-10:55"].cssClass).toBe("slot-busy");

    // All slots for this event should share the same eventKey
    expect(slots["0-10:00"].eventKey).toBe(slots["0-10:05"].eventKey);
    expect(slots["0-10:00"].eventKey).toBe(slots["0-10:55"].eventKey);

    // 11:00 slot should be free
    expect(slots["0-11:00"].cssClass).toBe("");
    expect(slots["0-11:00"].busy).toBe(false);
  });

  it("marks all slots as error when fetch failed", () => {
    const slots = computeUserSlots([], "2025-02-10", true);

    expect(slots["0-10:00"].cssClass).toBe("schedule-error-cell");
    expect(slots["0-10:00"].busy).toBe(true);
    expect(slots["0-10:00"].label).toBe("?");
    expect(slots["0-10:00"].tooltip).toBe("Laden fehlgeschlagen");
    expect(slots["0-10:00"].eventKey).toBeNull();
  });

  it("all-day events fill all slots for that day", () => {
    const events = [
      makeEvent({
        date: "2025-02-10",
        startTime: null,
        endTime: null,
        summary: "All Day",
      }),
    ];

    const slots = computeUserSlots(events, "2025-02-10", false);

    // All Monday slots should be busy
    expect(slots["0-07:00"].busy).toBe(true);
    expect(slots["0-12:00"].busy).toBe(true);
    expect(slots["0-18:55"].busy).toBe(true);

    // Tuesday slots should be free
    expect(slots["1-07:00"].busy).toBe(false);
  });
});

// ─── Cell Merging ────────────────────────────────────────────────────────────

describe("computeMergedCells", () => {
  const timeSlots = generateTimeSlots();

  it("merges consecutive slots with the same eventKey", () => {
    // Create a 1-hour event (12 x 5-min slots)
    const events = [
      makeEvent({
        date: "2025-02-10",
        startTime: "10:00",
        endTime: "11:00",
        summary: "Meeting",
      }),
    ];
    const slots = computeUserSlots(events, "2025-02-10", false);
    const merged = computeMergedCells(slots, timeSlots);

    // Find the merged cell for the event
    const eventCell = merged.find((c) => c.key === "0-10:00");
    expect(eventCell).toBeDefined();
    expect(eventCell!.colSpan).toBe(12); // 60 minutes / 5 = 12 slots
    expect(eventCell!.slot.cssClass).toBe("slot-busy");
  });

  it("does not merge free slots", () => {
    const slots = computeUserSlots([], "2025-02-10", false);
    const merged = computeMergedCells(slots, timeSlots);

    // All cells should have colSpan 1
    expect(merged.every((c) => c.colSpan === 1)).toBe(true);
    // Total cells should equal total slot count
    expect(merged).toHaveLength(144 * 5);
  });

  it("does not merge different events in adjacent slots", () => {
    const events = [
      makeEvent({
        date: "2025-02-10",
        startTime: "10:00",
        endTime: "10:30",
        summary: "Event A",
      }),
      makeEvent({
        date: "2025-02-10",
        startTime: "10:30",
        endTime: "11:00",
        summary: "Event B",
      }),
    ];
    const slots = computeUserSlots(events, "2025-02-10", false);
    const merged = computeMergedCells(slots, timeSlots);

    const cellA = merged.find((c) => c.key === "0-10:00");
    const cellB = merged.find((c) => c.key === "0-10:30");

    expect(cellA).toBeDefined();
    expect(cellB).toBeDefined();
    expect(cellA!.colSpan).toBe(6); // 30 min / 5 = 6 slots
    expect(cellB!.colSpan).toBe(6);
  });

  it("does not merge events across day boundaries", () => {
    // Events on Monday and Tuesday at different times
    const events = [
      makeEvent({
        date: "2025-02-10",
        startTime: "18:50",
        endTime: "18:55",
        summary: "Late Monday",
      }),
      makeEvent({
        date: "2025-02-11",
        startTime: "07:00",
        endTime: "07:05",
        summary: "Early Tuesday",
      }),
    ];
    const slots = computeUserSlots(events, "2025-02-10", false);
    const merged = computeMergedCells(slots, timeSlots);

    // Last Monday slot and first Tuesday slot should be separate cells
    const mondayLast = merged.find((c) => c.key === "0-18:50");
    const tuesdayFirst = merged.find((c) => c.key === "1-07:00");

    expect(mondayLast).toBeDefined();
    expect(tuesdayFirst).toBeDefined();
    expect(mondayLast!.colSpan).toBe(1);
    expect(tuesdayFirst!.colSpan).toBe(1);
  });

  it("does not merge error cells", () => {
    const slots = computeUserSlots([], "2025-02-10", true);
    const merged = computeMergedCells(slots, timeSlots);

    // Error cells have eventKey: null, so they should not be merged
    expect(merged.every((c) => c.colSpan === 1)).toBe(true);
  });

  it("sets isFirstSlotOfDay correctly", () => {
    const slots = computeUserSlots([], "2025-02-10", false);
    const merged = computeMergedCells(slots, timeSlots);

    // First slot of each day should have isFirstSlotOfDay = true
    const firstMondayCell = merged.find((c) => c.key === "0-07:00");
    const firstTuesdayCell = merged.find((c) => c.key === "1-07:00");
    const midMondayCell = merged.find((c) => c.key === "0-10:00");

    expect(firstMondayCell!.isFirstSlotOfDay).toBe(true);
    expect(firstTuesdayCell!.isFirstSlotOfDay).toBe(true);
    expect(midMondayCell!.isFirstSlotOfDay).toBe(false);
  });

  it("recomputes label to use available merged width", () => {
    const events = [
      makeEvent({
        date: "2025-02-10",
        startTime: "10:00",
        endTime: "11:00",
        summary: "Important Team Meeting",
      }),
    ];
    const slots = computeUserSlots(events, "2025-02-10", false);
    const merged = computeMergedCells(slots, timeSlots);

    const eventCell = merged.find((c) => c.key === "0-10:00");
    expect(eventCell).toBeDefined();
    // With colSpan=12, maxChars = floor(12*5/6) = 10
    // "Important Team Meeting" (22 chars) → first 9 chars + ellipsis
    expect(eventCell!.slot.label).toBe("Important\u2026");
  });

  it("preserves total column count across all merged cells per day", () => {
    const events = [
      makeEvent({
        date: "2025-02-10",
        startTime: "09:00",
        endTime: "10:00",
        summary: "Morning",
      }),
      makeEvent({
        date: "2025-02-10",
        startTime: "14:00",
        endTime: "15:30",
        summary: "Afternoon",
      }),
    ];
    const slots = computeUserSlots(events, "2025-02-10", false);
    const merged = computeMergedCells(slots, timeSlots);

    // Sum of colSpans for each day should equal 144
    for (let dayIdx = 0; dayIdx < WEEKDAY_COUNT; dayIdx++) {
      const dayCells = merged.filter((c) => c.dayIdx === dayIdx);
      const totalCols = dayCells.reduce((sum, c) => sum + c.colSpan, 0);
      expect(totalCols).toBe(144);
    }
  });
});

// ─── "All Free" Computation ──────────────────────────────────────────────────

describe("computeAllFreeSlots", () => {
  it("marks slots as all-free when no user is busy", () => {
    const rows: ScheduleRow[] = [
      {
        user: makeUser("User 1", "/user1/"),
        slots: { "0-10:00": { cssClass: "", label: null, tooltip: null, busy: false, eventKey: null } },
      },
      {
        user: makeUser("User 2", "/user2/"),
        slots: { "0-10:00": { cssClass: "", label: null, tooltip: null, busy: false, eventKey: null } },
      },
    ];

    const allFreeSlots = computeAllFreeSlots(rows);

    expect(allFreeSlots["0-10:00"].cssClass).toBe("slot-all-free");
    expect(allFreeSlots["0-10:00"].busy).toBe(false);
  });

  it("marks slots as not-all-free when any user is busy", () => {
    const rows: ScheduleRow[] = [
      {
        user: makeUser("User 1", "/user1/"),
        slots: { "0-10:00": { cssClass: "slot-busy", label: null, tooltip: null, busy: true, eventKey: "key1" } },
      },
      {
        user: makeUser("User 2", "/user2/"),
        slots: { "0-10:00": { cssClass: "", label: null, tooltip: null, busy: false, eventKey: null } },
      },
    ];

    const allFreeSlots = computeAllFreeSlots(rows);

    expect(allFreeSlots["0-10:00"].cssClass).toBe("slot-not-all-free");
    expect(allFreeSlots["0-10:00"].busy).toBe(true);
  });
});

// ─── buildScheduleRows ──────────────────────────────────────────────────────

describe("buildScheduleRows", () => {
  it("creates one row per user plus All Free summary row", () => {
    const users = [
      makeUser("User 1", "/user1/"),
      makeUser("User 2", "/user2/"),
    ];
    const events = new Map<string, CalDavEvent[]>();
    events.set("/user1/", []);
    events.set("/user2/", []);
    const failedUsers = new Set<string>();

    const rows = buildScheduleRows(users, events, failedUsers, "2025-02-10");

    expect(rows).toHaveLength(3); // 2 users + 1 "All Free"
    expect(rows[0].user?.displayName).toBe("User 1");
    expect(rows[1].user?.displayName).toBe("User 2");
    expect(rows[2].user).toBeNull(); // "All Free" row
  });

  it("includes failed users in results", () => {
    const users = [makeUser("Failed User", "/failed/")];
    const events = new Map<string, CalDavEvent[]>();
    const failedUsers = new Set<string>(["/failed/"]);

    const rows = buildScheduleRows(users, events, failedUsers, "2025-02-10");

    expect(rows[0].slots["0-10:00"].cssClass).toBe("schedule-error-cell");
  });
});

// ─── Date/Time Helpers ───────────────────────────────────────────────────────

describe("addDays", () => {
  it("adds days to an ISO date", () => {
    expect(addDays("2025-02-10", 0)).toBe("2025-02-10");
    expect(addDays("2025-02-10", 1)).toBe("2025-02-11");
    expect(addDays("2025-02-10", 4)).toBe("2025-02-14");
    expect(addDays("2025-02-10", 7)).toBe("2025-02-17");
  });

  it("handles month boundaries", () => {
    expect(addDays("2025-01-30", 2)).toBe("2025-02-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("handles year boundaries", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });
});

describe("formatTimeForDisplay", () => {
  it("strips leading zero from hour", () => {
    expect(formatTimeForDisplay("07:00")).toBe("7:00");
    expect(formatTimeForDisplay("09:30")).toBe("9:30");
  });

  it("keeps times without leading zero unchanged", () => {
    expect(formatTimeForDisplay("10:00")).toBe("10:00");
    expect(formatTimeForDisplay("14:30")).toBe("14:30");
  });
});

describe("getMondayOfWeek", () => {
  it("returns Monday for a Monday", () => {
    // 2025-02-10 is a Monday
    expect(getMondayOfWeek(new Date(2025, 1, 10))).toBe("2025-02-10");
  });

  it("returns Monday for a Wednesday", () => {
    // 2025-02-12 is a Wednesday
    expect(getMondayOfWeek(new Date(2025, 1, 12))).toBe("2025-02-10");
  });

  it("returns Monday for a Friday", () => {
    // 2025-02-14 is a Friday
    expect(getMondayOfWeek(new Date(2025, 1, 14))).toBe("2025-02-10");
  });

  it("returns Monday for a Sunday", () => {
    // 2025-02-16 is a Sunday
    expect(getMondayOfWeek(new Date(2025, 1, 16))).toBe("2025-02-10");
  });
});

describe("formatWeekLabel", () => {
  it("formats week label correctly", () => {
    expect(formatWeekLabel("2025-02-10")).toBe("10. Feb - 14. Feb 2025");
  });

  it("handles month boundary", () => {
    expect(formatWeekLabel("2025-01-27")).toBe("27. Jan - 31. Jan 2025");
  });

  it("handles cross-month week", () => {
    // Monday Jan 27 to Friday Jan 31 (stays in January)
    // But Monday Feb 24 to Friday Feb 28
    expect(formatWeekLabel("2025-02-24")).toBe("24. Feb - 28. Feb 2025");
  });
});

describe("getWeekdayDate", () => {
  it("returns correct dates for each weekday", () => {
    expect(getWeekdayDate("2025-02-10", 0)).toBe("2025-02-10"); // Monday
    expect(getWeekdayDate("2025-02-10", 1)).toBe("2025-02-11"); // Tuesday
    expect(getWeekdayDate("2025-02-10", 4)).toBe("2025-02-14"); // Friday
  });
});

describe("formatDayHeader", () => {
  it("formats day header correctly", () => {
    expect(formatDayHeader("2025-02-10", 0)).toBe("Mo 10. Feb");
    expect(formatDayHeader("2025-02-10", 1)).toBe("Di 11. Feb");
    expect(formatDayHeader("2025-02-10", 4)).toBe("Fr 14. Feb");
  });
});

// ─── Calendar View: Overlap Layout Tests ─────────────────────────────────────

describe("generateHourLabels", () => {
  it("returns labels from 7:00 to 18:00", () => {
    const labels = generateHourLabels();
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe("7:00");
    expect(labels[11]).toBe("18:00");
  });
});

describe("timeToPixels", () => {
  it("returns 0 for 07:00 (start of schedule)", () => {
    expect(timeToPixels("07:00")).toBe(0);
  });

  it("returns correct offset for 08:00", () => {
    expect(timeToPixels("08:00")).toBe(HOUR_HEIGHT_PX);
  });

  it("returns correct offset for 12:30", () => {
    // 5.5 hours from 07:00
    expect(timeToPixels("12:30")).toBe(5.5 * HOUR_HEIGHT_PX);
  });

  it("clamps times before 07:00 to 0", () => {
    expect(timeToPixels("06:00")).toBe(0);
  });

  it("clamps times after 19:00 to the grid height", () => {
    expect(timeToPixels("20:00")).toBe(12 * HOUR_HEIGHT_PX);
  });
});

describe("layoutOverlappingEvents", () => {
  const userA: CalDavUser = { displayName: "Alice", href: "/alice" };
  const userB: CalDavUser = { displayName: "Bob", href: "/bob" };

  it("returns empty for no events", () => {
    const result = layoutOverlappingEvents([]);
    expect(result.entries).toHaveLength(0);
    expect(result.totalColumns).toBe(0);
  });

  it("places a single event in column 0", () => {
    const result = layoutOverlappingEvents([
      {
        event: makeEvent({ startTime: "09:00", endTime: "10:00" }),
        user: userA,
        userIndex: 0,
      },
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.totalColumns).toBe(1);
    expect(result.entries[0].col).toBe(0);
  });

  it("places non-overlapping events in the same column", () => {
    const result = layoutOverlappingEvents([
      {
        event: makeEvent({ startTime: "09:00", endTime: "10:00" }),
        user: userA,
        userIndex: 0,
      },
      {
        event: makeEvent({ startTime: "10:00", endTime: "11:00" }),
        user: userB,
        userIndex: 1,
      },
    ]);
    expect(result.totalColumns).toBe(1);
    expect(result.entries[0].col).toBe(0);
    expect(result.entries[1].col).toBe(0);
  });

  it("places overlapping events in different columns", () => {
    const result = layoutOverlappingEvents([
      {
        event: makeEvent({ startTime: "09:00", endTime: "10:30" }),
        user: userA,
        userIndex: 0,
      },
      {
        event: makeEvent({ startTime: "10:00", endTime: "11:00" }),
        user: userB,
        userIndex: 1,
      },
    ]);
    expect(result.totalColumns).toBe(2);
    // Different columns
    expect(result.entries[0].col).not.toBe(result.entries[1].col);
  });

  it("handles three overlapping events in three columns", () => {
    const result = layoutOverlappingEvents([
      {
        event: makeEvent({ startTime: "09:00", endTime: "11:00" }),
        user: userA,
        userIndex: 0,
      },
      {
        event: makeEvent({ startTime: "09:30", endTime: "10:30" }),
        user: userA,
        userIndex: 0,
      },
      {
        event: makeEvent({ startTime: "10:00", endTime: "10:45" }),
        user: userB,
        userIndex: 1,
      },
    ]);
    expect(result.totalColumns).toBe(3);
    const cols = result.entries.map((e) => e.col);
    // All unique columns
    expect(new Set(cols).size).toBe(3);
  });

  it("reuses columns once events end", () => {
    const result = layoutOverlappingEvents([
      {
        event: makeEvent({ startTime: "09:00", endTime: "10:00" }),
        user: userA,
        userIndex: 0,
      },
      {
        event: makeEvent({ startTime: "09:00", endTime: "10:00" }),
        user: userB,
        userIndex: 1,
      },
      {
        // Starts after both end — should reuse column 0
        event: makeEvent({ startTime: "10:00", endTime: "11:00" }),
        user: userA,
        userIndex: 0,
      },
    ]);
    expect(result.totalColumns).toBe(2);
    // The third event should reuse column 0
    const sorted = [...result.entries].sort((a, b) => a.startMin - b.startMin || a.col - b.col);
    expect(sorted[2].col).toBe(0);
  });

  it("handles all-day events (null times)", () => {
    const result = layoutOverlappingEvents([
      {
        event: makeEvent({ startTime: null, endTime: null }),
        user: userA,
        userIndex: 0,
      },
      {
        event: makeEvent({ startTime: "09:00", endTime: "10:00" }),
        user: userB,
        userIndex: 1,
      },
    ]);
    expect(result.totalColumns).toBe(2);
  });
});

describe("buildPositionedEventsForDay", () => {
  const userA: CalDavUser = { displayName: "Alice", href: "/alice" };

  it("returns empty array when no events for the day", () => {
    const events = new Map<string, CalDavEvent[]>();
    events.set("/alice", []);
    const result = buildPositionedEventsForDay([userA], events, "2025-02-10");
    expect(result).toHaveLength(0);
  });

  it("positions a single event correctly", () => {
    const events = new Map<string, CalDavEvent[]>();
    events.set("/alice", [
      makeEvent({ date: "2025-02-10", startTime: "09:00", endTime: "10:00" }),
    ]);
    const result = buildPositionedEventsForDay([userA], events, "2025-02-10");
    expect(result).toHaveLength(1);
    expect(result[0].top).toBe(2 * HOUR_HEIGHT_PX); // 09:00 is 2 hours from 07:00
    expect(result[0].height).toBe(HOUR_HEIGHT_PX);   // 1 hour
    expect(result[0].left).toBe(0);
    expect(result[0].width).toBe(1);
    expect(result[0].userIndex).toBe(0);
    expect(result[0].user).toBe(userA);
  });

  it("ignores events for different days", () => {
    const events = new Map<string, CalDavEvent[]>();
    events.set("/alice", [
      makeEvent({ date: "2025-02-11", startTime: "09:00", endTime: "10:00" }),
    ]);
    const result = buildPositionedEventsForDay([userA], events, "2025-02-10");
    expect(result).toHaveLength(0);
  });
});
