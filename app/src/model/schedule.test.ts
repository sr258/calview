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
 * - Tooltips
 * - Full slot computation
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
  buildTooltip,
  computeUserSlots,
  computeAllFreeSlots,
  buildScheduleRows,
  addDays,
  formatTimeForDisplay,
  getMondayOfWeek,
  formatWeekLabel,
  getWeekdayDate,
  formatDayHeader,
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
    expect(SLOT_MINUTES).toBe(30);
    expect(WEEKDAY_COUNT).toBe(5);
  });

  it("has correct day short names", () => {
    expect(DAY_SHORT_NAMES).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });
});

// ─── Time Slot Generation ────────────────────────────────────────────────────

describe("generateTimeSlots", () => {
  it("generates correct time slots from 07:00 to 18:30", () => {
    const slots = generateTimeSlots();

    expect(slots[0]).toBe("07:00");
    expect(slots[1]).toBe("07:30");
    expect(slots[slots.length - 1]).toBe("18:30");

    // 07:00 to 19:00 = 12 hours = 24 half-hour slots
    expect(slots).toHaveLength(24);
  });

  it("has consistent 30-minute increments", () => {
    const slots = generateTimeSlots();
    for (let i = 1; i < slots.length; i++) {
      const [prevH, prevM] = slots[i - 1].split(":").map(Number);
      const [currH, currM] = slots[i].split(":").map(Number);
      const diffMinutes = (currH * 60 + currM) - (prevH * 60 + prevM);
      expect(diffMinutes).toBe(30);
    }
  });
});

describe("generateSlotKeys", () => {
  it("generates keys for all weekdays and time slots", () => {
    const keys = generateSlotKeys();
    // 5 days * 24 slots = 120 keys
    expect(keys).toHaveLength(120);
  });

  it("has correct format dayIdx-HH:mm", () => {
    const keys = generateSlotKeys();
    expect(keys[0]).toBe("0-07:00");
    expect(keys[1]).toBe("0-07:30");
    expect(keys[23]).toBe("0-18:30");
    expect(keys[24]).toBe("1-07:00");
    expect(keys[119]).toBe("4-18:30");
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
      makeEvent({ startTime: "09:30", endTime: "10:30" }), // overlaps 10:00-10:30
      makeEvent({ startTime: "11:00", endTime: "12:00" }), // does not overlap
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:30");

    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].startTime).toBe("09:30");
  });

  it("all-day events overlap every slot", () => {
    const events = [
      makeEvent({ startTime: null, endTime: null }), // all-day
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:30");

    expect(overlapping).toHaveLength(1);
  });

  it("event ending at slot start does not overlap", () => {
    const events = [
      makeEvent({ startTime: "09:00", endTime: "10:00" }),
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:30");

    expect(overlapping).toHaveLength(0);
  });

  it("event starting at slot end does not overlap", () => {
    const events = [
      makeEvent({ startTime: "10:30", endTime: "11:00" }),
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:30");

    expect(overlapping).toHaveLength(0);
  });

  it("finds multiple overlapping events", () => {
    const events = [
      makeEvent({ startTime: "09:00", endTime: "10:30" }),
      makeEvent({ startTime: "10:00", endTime: "11:00" }),
      makeEvent({ startTime: "10:15", endTime: "10:45" }),
    ];

    const overlapping = findOverlappingEvents(events, "10:00", "10:30");

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
  it("returns truncated summary for accessible events", () => {
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
});

// ─── Tooltips ────────────────────────────────────────────────────────────────

describe("buildTooltip", () => {
  it("returns null for empty events", () => {
    expect(buildTooltip([], "10:00", "10:30")).toBeNull();
  });

  it("shows summary and time for accessible events", () => {
    const events = [
      makeEvent({ summary: "Meeting", startTime: "10:00", endTime: "11:00" }),
    ];

    const tooltip = buildTooltip(events, "10:00", "10:30");

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

    const tooltip = buildTooltip(events, "10:00", "10:30");

    expect(tooltip).toBe("BUSY (10:00 - 11:00)");
  });

  it("joins multiple events with newlines", () => {
    const events = [
      makeEvent({ summary: "Event A", startTime: "10:00", endTime: "10:30" }),
      makeEvent({ summary: "Event B", startTime: "10:00", endTime: "11:00" }),
    ];

    const tooltip = buildTooltip(events, "10:00", "10:30");

    expect(tooltip).toBe(
      "Event A (10:00 - 10:30)\nEvent B (10:00 - 11:00)"
    );
  });

  it("formats times without leading zeros", () => {
    const events = [
      makeEvent({ summary: "Early", startTime: "07:00", endTime: "08:30" }),
    ];

    const tooltip = buildTooltip(events, "07:00", "07:30");

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
  });

  it("marks busy slots with correct cssClass", () => {
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

    // 10:30 slot should also be busy (event goes 10:00-11:00)
    expect(slots["0-10:30"].cssClass).toBe("slot-busy");
    expect(slots["0-10:30"].busy).toBe(true);

    // 11:00 slot should be free
    expect(slots["0-11:00"].cssClass).toBe("");
    expect(slots["0-11:00"].busy).toBe(false);
  });

  it("marks all slots as error when fetch failed", () => {
    const slots = computeUserSlots([], "2025-02-10", true);

    expect(slots["0-10:00"].cssClass).toBe("schedule-error-cell");
    expect(slots["0-10:00"].busy).toBe(true);
    expect(slots["0-10:00"].label).toBe("?");
    expect(slots["0-10:00"].tooltip).toBe("Failed to load");
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
    expect(slots["0-18:30"].busy).toBe(true);

    // Tuesday slots should be free
    expect(slots["1-07:00"].busy).toBe(false);
  });
});

// ─── "All Free" Computation ──────────────────────────────────────────────────

describe("computeAllFreeSlots", () => {
  it("marks slots as all-free when no user is busy", () => {
    const rows: ScheduleRow[] = [
      {
        user: makeUser("User 1", "/user1/"),
        slots: { "0-10:00": { cssClass: "", label: null, tooltip: null, busy: false } },
      },
      {
        user: makeUser("User 2", "/user2/"),
        slots: { "0-10:00": { cssClass: "", label: null, tooltip: null, busy: false } },
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
        slots: { "0-10:00": { cssClass: "slot-busy", label: null, tooltip: null, busy: true } },
      },
      {
        user: makeUser("User 2", "/user2/"),
        slots: { "0-10:00": { cssClass: "", label: null, tooltip: null, busy: false } },
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
    expect(formatWeekLabel("2025-02-10")).toBe("Feb 10 - Feb 14, 2025");
  });

  it("handles month boundary", () => {
    expect(formatWeekLabel("2025-01-27")).toBe("Jan 27 - Jan 31, 2025");
  });

  it("handles cross-month week", () => {
    // Monday Jan 27 to Friday Jan 31 (stays in January)
    // But Monday Feb 24 to Friday Feb 28
    expect(formatWeekLabel("2025-02-24")).toBe("Feb 24 - Feb 28, 2025");
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
    expect(formatDayHeader("2025-02-10", 0)).toBe("Mon Feb 10");
    expect(formatDayHeader("2025-02-10", 1)).toBe("Tue Feb 11");
    expect(formatDayHeader("2025-02-10", 4)).toBe("Fri Feb 14");
  });
});
