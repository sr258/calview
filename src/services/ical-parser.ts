/**
 * iCalendar text parser — regex-based, ported directly from CalDavClient.java.
 *
 * Parses raw iCalendar (RFC 5545) text into CalDavEvent records.
 * Uses the same regex approach as the Java code rather than a library.
 *
 * Ported from: CalDavClient.java lines 420-661
 */

import type { CalDavEvent } from "../model/types.js";
import { addDays, DAY_END } from "../model/schedule.js";

// ─── iCalendar property patterns ─────────────────────────────────────────────
// Ported from CalDavClient.java lines 421-426

const SUMMARY_PATTERN = /^SUMMARY[;:](.*)/m;
const DTSTART_PATTERN = /^DTSTART[;:](.*)/m;
const DTEND_PATTERN = /^DTEND[;:](.*)/m;
const DURATION_PATTERN = /^DURATION[;:](.*)/m;
const CLASS_PATTERN = /^CLASS[;:](.*)/m;
const STATUS_PATTERN = /^STATUS[;:](.*)/m;
const RRULE_PATTERN = /^RRULE[;:](.*)/m;
const RECURRENCE_ID_PATTERN = /^RECURRENCE-ID[;:](.*)/m;
const EXDATE_PATTERN = /^EXDATE[;:](.*)/gm;
const FREEBUSY_PATTERN = /^FREEBUSY[;:](.*)/gm;
const LOCATION_PATTERN = /^LOCATION[;:](.*)/m;
const DESCRIPTION_PATTERN = /^DESCRIPTION[;:](.*)/m;
// ORGANIZER/ATTENDEE keep their parameters (e.g. CN=...) separate from the
// value, since the display name (CN) is more useful to show than the raw
// mailto: URI.
const ORGANIZER_PATTERN = /^ORGANIZER([^:\r\n]*):(.*)/m;
const ATTENDEE_PATTERN = /^ATTENDEE([^:\r\n]*):(.*)/gm;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parses raw iCalendar text data into CalDavEvent records.
 *
 * When rangeStart/rangeEnd are provided, recurring events (with RRULE)
 * are expanded client-side within that range, with EXDATE dates excluded.
 * This ensures deleted occurrences are never displayed, regardless of
 * server-side expand support.
 *
 * Ported from: CalDavClient.java parseICalendarData() lines 436-492
 */
export function parseICalendarData(
  icalData: string,
  accessible: boolean,
  rangeStart?: string,
  rangeEnd?: string
): CalDavEvent[] {
  // Unfold lines: iCal spec says lines can be folded with CRLF + whitespace
  const unfolded = icalData.replace(/\r?\n[ \t]/g, "");

  // Collect all EXDATE values (deleted occurrences of recurring events).
  const exdates = new Set<string>();
  EXDATE_PATTERN.lastIndex = 0;
  let exdateMatch: RegExpExecArray | null;
  while ((exdateMatch = EXDATE_PATTERN.exec(unfolded)) !== null) {
    const rawValue = exdateMatch[1].trim();
    let dateList = rawValue;
    const colonIdx = rawValue.indexOf(":");
    if (colonIdx >= 0 && rawValue.includes("=")) {
      dateList = rawValue.substring(colonIdx + 1).trim();
    }
    for (const dateStr of dateList.split(",")) {
      const trimmed = dateStr.trim();
      if (trimmed.length >= 8) {
        const normalized = trimmed.replace("Z", "");
        exdates.add(normalized);
        // Also add date-only key to handle timezone offset mismatches
        // (e.g. DTSTART in local time vs EXDATE in UTC)
        if (normalized.length > 8) {
          exdates.add(normalized.substring(0, 8));
        }
      }
    }
  }

  // Parse all VEVENT blocks into classified entries
  interface VEventEntry {
    block: string;
    summary: string | null;
    dtstart: string;       // raw extracted value (e.g. "20250210T100000Z")
    dtend: string | null;
    duration: string | null;
    classValue: string | null;
    rrule: string | null;
    recurrenceId: string | null;
    location: string | null;
    description: string | null;
    organizer: string | null;
    attendees: string[];
  }

  const masters: VEventEntry[] = [];
  const overrides: VEventEntry[] = [];
  const singles: VEventEntry[] = [];

  let veventStart = 0;
  while ((veventStart = unfolded.indexOf("BEGIN:VEVENT", veventStart)) !== -1) {
    const veventEnd = unfolded.indexOf("END:VEVENT", veventStart);
    if (veventEnd === -1) break;

    const veventBlock = unfolded.substring(veventStart, veventEnd);
    const statusValue = extractICalProperty(veventBlock, STATUS_PATTERN);

    // Skip cancelled occurrences
    if (statusValue !== null && statusValue.trim().toUpperCase() === "CANCELLED") {
      veventStart = veventEnd + 1;
      continue;
    }

    const dtstart = extractICalProperty(veventBlock, DTSTART_PATTERN);
    if (dtstart === null) {
      veventStart = veventEnd + 1;
      continue;
    }

    const entry: VEventEntry = {
      block: veventBlock,
      summary: extractICalProperty(veventBlock, SUMMARY_PATTERN),
      dtstart,
      dtend: extractICalProperty(veventBlock, DTEND_PATTERN),
      duration: extractICalProperty(veventBlock, DURATION_PATTERN),
      classValue: extractICalProperty(veventBlock, CLASS_PATTERN),
      rrule: extractICalProperty(veventBlock, RRULE_PATTERN),
      recurrenceId: extractICalProperty(veventBlock, RECURRENCE_ID_PATTERN),
      location: unescapeICalText(extractICalProperty(veventBlock, LOCATION_PATTERN)),
      description: unescapeICalText(extractICalProperty(veventBlock, DESCRIPTION_PATTERN)),
      organizer: extractOrganizer(veventBlock),
      attendees: extractAttendees(veventBlock),
    };

    if (entry.rrule !== null) {
      masters.push(entry);
    } else if (entry.recurrenceId !== null) {
      overrides.push(entry);
    } else {
      singles.push(entry);
    }

    veventStart = veventEnd + 1;
  }

  const events: CalDavEvent[] = [];

  // Build a map of override dates for quick lookup
  const overridesByDate = new Map<string, VEventEntry>();
  for (const ov of overrides) {
    const recId = ov.recurrenceId!;
    const normalized = recId.replace("Z", "");
    overridesByDate.set(normalized, ov);
    // Also key by date-only for all-day matching
    if (normalized.length > 8) {
      overridesByDate.set(normalized.substring(0, 8), ov);
    }
  }

  // Expand master VEVENTs (those with RRULE)
  for (const master of masters) {
    if (rangeStart && rangeEnd) {
      // The master's day span (all-day, multi-day or overnight) is carried over
      // to every occurrence. Expand from `spanDays` before the range start so
      // occurrences that begin before the range but still reach into it are
      // not dropped.
      const masterStartDate = parseICalDate(master.dtstart);
      const spanDays = masterStartDate !== null
        ? daysBetweenISODates(
            masterStartDate,
            computeEndDate(master.dtstart, master.dtend, master.duration, masterStartDate)
          )
        : 0;

      const occurrences = expandRRule(
        master.dtstart,
        master.rrule!,
        exdates,
        spanDays > 0 ? addDays(rangeStart, -spanDays) : rangeStart,
        rangeEnd
      );

      for (const occDtstart of occurrences) {
        const normalized = occDtstart.replace("Z", "");
        // Check if there's an override for this occurrence
        const override = overridesByDate.get(normalized)
          ?? overridesByDate.get(normalized.substring(0, 8));

        if (override) {
          // Use override properties (it will be added below with overrides)
          continue;
        }

        // Create event from master properties with adjusted date/time
        const date = parseICalDate(occDtstart);
        if (date === null) continue;

        const startTime = parseICalTime(occDtstart);
        let endTime: string | null = null;
        const endDate = spanDays > 0 ? addDays(date, spanDays) : date;

        // Compute end time from the master's DTEND offset or DURATION
        if (master.dtend !== null && startTime !== null) {
          const masterStartTime = parseICalTime(master.dtstart);
          const masterEndTime = parseICalTime(master.dtend);
          if (masterStartTime !== null && masterEndTime !== null) {
            // Compute duration from master and apply to occurrence. An end
            // time before the start time means the event runs past midnight.
            const startMins = parseTimeToMinutes(masterStartTime);
            const endMins = parseTimeToMinutes(masterEndTime);
            const durationMins = (endMins - startMins + MINUTES_PER_DAY) % MINUTES_PER_DAY;
            const occStartMins = parseTimeToMinutes(startTime);
            endTime = formatMinutesToTime(occStartMins + durationMins);
          }
        } else if (master.duration !== null && startTime !== null) {
          endTime = parseDurationEndTime(startTime, master.duration.trim());
        }

        const status = master.classValue !== null ? master.classValue.trim() : "PUBLIC";
        const ev = makeEvent(
          master.summary, date, endDate, startTime, endTime, status, accessible,
          master.location, master.description, master.organizer, master.attendees
        );
        events.push(ev);
      }
    } else {
      // No range provided — treat master as a single event (legacy/fallback)
      const ev = entryToEvent(master, accessible, exdates);
      if (ev) { events.push(ev); }
    }
  }

  // Add override VEVENTs (individual modified occurrences)
  for (const ov of overrides) {
    const ev = entryToEvent(ov, accessible, exdates);
    if (ev) { events.push(ev); }
  }

  // Add single VEVENTs (non-recurring events)
  for (const single of singles) {
    const ev = entryToEvent(single, accessible, exdates);
    if (ev) { events.push(ev); }
  }

  return events;
}

/**
 * Converts a parsed VEVENT entry to a CalDavEvent, filtering against EXDATE.
 */
function entryToEvent(
  entry: {
    summary: string | null; dtstart: string; dtend: string | null; duration: string | null; classValue: string | null;
    location: string | null; description: string | null; organizer: string | null; attendees: string[];
  },
  accessible: boolean,
  exdates: Set<string>
): CalDavEvent | null {
  // Check EXDATE exclusion
  const normalizedDtstart = entry.dtstart.replace("Z", "");
  const dateOnly = normalizedDtstart.substring(0, 8);
  if (exdates.has(normalizedDtstart) || exdates.has(dateOnly)) {
    return null;
  }
  // Check datetime EXDATE against date-only DTSTART
  if (normalizedDtstart.length <= 8) {
    for (const exdate of exdates) {
      if (exdate.startsWith(dateOnly)) return null;
    }
  }

  const date = parseICalDate(entry.dtstart);
  const startTime = parseICalTime(entry.dtstart);
  let endTime = entry.dtend !== null ? parseICalTime(entry.dtend) : null;
  if (endTime === null && entry.duration !== null && startTime !== null) {
    endTime = parseDurationEndTime(startTime, entry.duration.trim());
  }
  const status = entry.classValue !== null ? entry.classValue.trim() : "PUBLIC";

  if (date === null) return null;

  const endDate = computeEndDate(entry.dtstart, entry.dtend, entry.duration, date);

  return makeEvent(
    entry.summary, date, endDate, startTime, endTime, status, accessible,
    entry.location, entry.description, entry.organizer, entry.attendees
  );
}

/**
 * Computes the inclusive last day of an event's span as an ISO date string.
 *
 * Both DTEND and DURATION describe an *exclusive* end per RFC 5545, so the
 * last day actually occupied is one day earlier whenever the end falls on a
 * day boundary (a date-only DTEND, or a date-time DTEND at exactly midnight).
 * The result is never earlier than `startDate`, so degenerate events with
 * DTEND == DTSTART still occupy their start day.
 */
function computeEndDate(
  dtstart: string,
  dtend: string | null,
  duration: string | null,
  startDate: string
): string {
  const isDateOnly = !dtstart.includes("T");

  if (dtend !== null) {
    const endDateRaw = parseICalDate(dtend);
    if (endDateRaw === null) return startDate;

    // A date-only end, or a date-time end at exactly midnight, is the first
    // day *after* the event.
    const endsOnDayBoundary = isDateOnly || (parseICalTime(dtend) ?? "00:00") === "00:00";
    const inclusive = endsOnDayBoundary ? addDays(endDateRaw, -1) : endDateRaw;
    return inclusive < startDate ? startDate : inclusive;
  }

  if (duration !== null) {
    const durationMins = parseDurationMinutes(duration.trim());
    if (durationMins === null || durationMins <= 0) return startDate;

    const startMins = isDateOnly ? 0 : parseTimeToMinutes(parseICalTime(dtstart) ?? "00:00");
    // Exclusive end instant, expressed in minutes from midnight of the start day.
    const endMins = startMins + durationMins;
    // Subtract one minute so an end exactly on a day boundary stays on the
    // previous day.
    return addDays(startDate, Math.floor((endMins - 1) / MINUTES_PER_DAY));
  }

  return startDate;
}

/** Minutes in a day. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * Parses an ISO 8601 / RFC 5545 duration ("P1D", "P2W", "PT1H30M", "P1DT2H")
 * into total minutes. Returns null if the duration cannot be parsed.
 */
export function parseDurationMinutes(duration: string): number | null {
  const match =
    /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      duration
    );
  // A match with no numeric component at all ("P", "PT", "-P") is degenerate:
  // the regex accepts it, but it carries no duration.
  if (!match || match.slice(2).every((group) => group === undefined)) {
    console.warn("Failed to parse duration:", duration);
    return null;
  }

  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const num = (v: string | undefined): number => (v ? parseInt(v, 10) : 0);
  const total =
    num(weeks) * 7 * MINUTES_PER_DAY +
    num(days) * MINUTES_PER_DAY +
    num(hours) * 60 +
    num(minutes) +
    Math.floor(num(seconds) / 60);

  return sign === "-" ? -total : total;
}

/**
 * Returns the number of days between two ISO date strings "YYYY-MM-DD" (b - a).
 */
function daysBetweenISODates(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86400000);
}

/**
 * Creates a CalDavEvent record.
 */
function makeEvent(
  summary: string | null,
  date: string,
  endDate: string,
  startTime: string | null,
  endTime: string | null,
  status: string,
  accessible: boolean,
  location: string | null = null,
  description: string | null = null,
  organizer: string | null = null,
  attendees: string[] = []
): CalDavEvent {
  // An end time of exactly midnight belongs to the *end* of `endDate`, not its
  // start: computeEndDate() has already rolled the day back for such ends, so
  // the fragment on `endDate` runs to the last representable minute of the day.
  // Left as-is it would compare as "00:00", making the event overlap no slot.
  const end = startTime !== null && endTime === "00:00" ? DAY_END : endTime;

  if (accessible) {
    return {
      summary: summary !== null ? summary.trim() : "(Kein Titel)",
      date, endDate, startTime, endTime: end, status, accessible: true,
      location, description, organizer, attendees,
    };
  }
  return {
    summary: null,
    date, endDate, startTime, endTime: end, status, accessible: false,
  };
}

// ─── RRULE Expansion ─────────────────────────────────────────────────────────

/**
 * Parsed representation of an RRULE.
 */
interface RRule {
  freq: string;
  interval: number;
  count: number | null;
  until: string | null;
  byDay: string[] | null;
  byMonthDay: number[] | null;
}

/**
 * Parses an RRULE value string into a structured object.
 * Example: "FREQ=WEEKLY;INTERVAL=2;COUNT=10;BYDAY=MO,WE,FR"
 */
function parseRRuleString(rruleStr: string): RRule {
  const parts: Record<string, string> = {};
  for (const part of rruleStr.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx >= 0) {
      parts[part.substring(0, eqIdx)] = part.substring(eqIdx + 1);
    }
  }

  return {
    freq: parts["FREQ"] || "DAILY",
    interval: parts["INTERVAL"] ? parseInt(parts["INTERVAL"], 10) : 1,
    count: parts["COUNT"] ? parseInt(parts["COUNT"], 10) : null,
    until: parts["UNTIL"] || null,
    byDay: parts["BYDAY"] ? parts["BYDAY"].split(",") : null,
    byMonthDay: parts["BYMONTHDAY"]
      ? parts["BYMONTHDAY"].split(",").map((d) => parseInt(d, 10))
      : null,
  };
}

/** Maps iCal day abbreviations to JS Date.getUTCDay() values. */
const DAY_MAP: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/**
 * Expands an RRULE into occurrence DTSTART strings within [rangeStart, rangeEnd).
 *
 * @param masterDtstart  the master event's DTSTART (e.g. "20250210T100000Z" or "20250210")
 * @param rruleStr       the raw RRULE string (e.g. "FREQ=WEEKLY;COUNT=10")
 * @param exdates        set of normalized EXDATE strings to exclude
 * @param rangeStart     week start as "YYYY-MM-DD"
 * @param rangeEnd       week end as "YYYY-MM-DD"
 * @returns array of DTSTART strings for valid occurrences in the range
 */
export function expandRRule(
  masterDtstart: string,
  rruleStr: string,
  exdates: Set<string>,
  rangeStart: string,
  rangeEnd: string
): string[] {
  const rrule = parseRRuleString(rruleStr);
  const results: string[] = [];

  // Parse master DTSTART into a Date for arithmetic
  const isDateOnly = !masterDtstart.includes("T");
  const masterDate = icalToDate(masterDtstart);
  if (masterDate === null) return results;

  const rangeStartDate = new Date(rangeStart + "T00:00:00Z");
  const rangeEndDate = new Date(rangeEnd + "T00:00:00Z");

  // Parse UNTIL if present
  let untilDate: Date | null = null;
  if (rrule.until !== null) {
    untilDate = icalToDate(rrule.until);
  }

  // For WEEKLY with BYDAY, we need to know which days to generate
  const byDayNums: number[] | null = rrule.byDay
    ? rrule.byDay.map((d) => {
        // Strip ordinal prefix like "2MO" → "MO"
        const dayAbbr = d.replace(/^-?\d+/, "");
        return DAY_MAP[dayAbbr] ?? -1;
      }).filter((n) => n >= 0)
    : null;

  // Generate occurrences
  let count = 0;
  const MAX_ITERATIONS = 5000; // safety limit
  let iterations = 0;

  // Start from the master's date
  const current = new Date(masterDate);

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Check termination conditions
    if (rrule.count !== null && count >= rrule.count) break;
    if (untilDate !== null && current > untilDate) break;
    if (current >= rangeEndDate && count > 0) break;

    if (rrule.freq === "WEEKLY" && byDayNums !== null && byDayNums.length > 0) {
      // For WEEKLY with BYDAY: iterate each specified day in this week
      // Find the Monday of the current week
      const weekMonday = new Date(current);
      const dow = weekMonday.getUTCDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      weekMonday.setUTCDate(weekMonday.getUTCDate() + mondayOffset);

      for (const dayNum of byDayNums) {
        if (rrule.count !== null && count >= rrule.count) break;

        const occDate = new Date(weekMonday);
        // Offset from Monday: SU=0→6, MO=1→0, TU=2→1, etc.
        const offset = dayNum === 0 ? 6 : dayNum - 1;
        occDate.setUTCDate(weekMonday.getUTCDate() + offset);
        // Copy time from master
        occDate.setUTCHours(masterDate.getUTCHours(), masterDate.getUTCMinutes(), masterDate.getUTCSeconds());

        // Only count occurrences that are on or after the master start
        if (occDate < masterDate) {
          continue;
        }

        count++;

        if (rrule.count !== null && count > rrule.count) break;
        if (untilDate !== null && occDate > untilDate) break;

        if (occDate >= rangeStartDate && occDate < rangeEndDate) {
          const dtstr = dateToICal(occDate, isDateOnly);
          const normalized = dtstr.replace("Z", "");
          if (!exdates.has(normalized) && !exdates.has(normalized.substring(0, 8))) {
            results.push(dtstr);
          }
        }
      }

      // Advance to next week (respecting INTERVAL)
      current.setUTCDate(current.getUTCDate() + 7 * rrule.interval);
      // Reset to Monday of that week
      const newDow = current.getUTCDay();
      const newMondayOffset = newDow === 0 ? -6 : 1 - newDow;
      current.setUTCDate(current.getUTCDate() + newMondayOffset);
    } else {
      // For DAILY, WEEKLY (no BYDAY), MONTHLY, YEARLY
      if (rrule.freq === "MONTHLY" && rrule.byMonthDay !== null) {
        // Check if current day-of-month matches
        const dom = current.getUTCDate();
        if (rrule.byMonthDay.includes(dom)) {
          count++;
          if (current >= rangeStartDate && current < rangeEndDate) {
            const dtstr = dateToICal(current, isDateOnly);
            const normalized = dtstr.replace("Z", "");
            if (!exdates.has(normalized) && !exdates.has(normalized.substring(0, 8))) {
              results.push(dtstr);
            }
          }
        }
      } else {
        count++;
        if (current >= rangeStartDate && current < rangeEndDate) {
          const dtstr = dateToICal(current, isDateOnly);
          const normalized = dtstr.replace("Z", "");
          if (!exdates.has(normalized) && !exdates.has(normalized.substring(0, 8))) {
            results.push(dtstr);
          }
        }
      }

      // Advance to next occurrence
      switch (rrule.freq) {
        case "DAILY":
          current.setUTCDate(current.getUTCDate() + rrule.interval);
          break;
        case "WEEKLY":
          current.setUTCDate(current.getUTCDate() + 7 * rrule.interval);
          break;
        case "MONTHLY":
          current.setUTCMonth(current.getUTCMonth() + rrule.interval);
          break;
        case "YEARLY":
          current.setUTCFullYear(current.getUTCFullYear() + rrule.interval);
          break;
        default:
          current.setUTCDate(current.getUTCDate() + 1);
          break;
      }
    }
  }

  return results;
}

/**
 * Converts an iCal date/datetime string to a Date object.
 */
function icalToDate(dtValue: string): Date | null {
  try {
    const clean = dtValue.replace("Z", "").trim();
    if (clean.length >= 15) {
      // YYYYMMDDTHHmmss
      return new Date(Date.UTC(
        parseInt(clean.substring(0, 4), 10),
        parseInt(clean.substring(4, 6), 10) - 1,
        parseInt(clean.substring(6, 8), 10),
        parseInt(clean.substring(9, 11), 10),
        parseInt(clean.substring(11, 13), 10),
        parseInt(clean.substring(13, 15), 10)
      ));
    } else if (clean.length >= 8) {
      // YYYYMMDD
      return new Date(Date.UTC(
        parseInt(clean.substring(0, 4), 10),
        parseInt(clean.substring(4, 6), 10) - 1,
        parseInt(clean.substring(6, 8), 10)
      ));
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Converts a Date object back to an iCal date/datetime string.
 */
function dateToICal(date: Date, dateOnly: boolean): string {
  const y = date.getUTCFullYear().toString();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  if (dateOnly) {
    return `${y}${m}${d}`;
  }
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

/**
 * Parses "HH:mm" to total minutes.
 */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Formats total minutes to "HH:mm".
 */
function formatMinutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parses a free-busy-query REPORT response (raw iCalendar text with
 * VFREEBUSY component) into CalDavEvent records.
 *
 * FREEBUSY lines have the format:
 *   FREEBUSY;FBTYPE=BUSY:20250210T140000Z/20250210T150000Z
 *   FREEBUSY:20250210T140000Z/20250210T150000Z,20250211T090000Z/20250211T100000Z
 *   FREEBUSY;FBTYPE=BUSY-TENTATIVE:20250212T080000Z/PT1H
 *
 * Each period is start/end or start/duration. Multiple periods can be
 * comma-separated on a single line.
 *
 * Ported from: CalDavClient.java parseFreeBusyResponse() lines 526-605
 */
export function parseFreeBusyResponse(icalBody: string): CalDavEvent[] {
  const events: CalDavEvent[] = [];

  // Unfold lines
  const unfolded = icalBody.replace(/\r?\n[ \t]/g, "");

  // Find the VFREEBUSY block
  const fbStart = unfolded.indexOf("BEGIN:VFREEBUSY");
  const fbEnd = unfolded.indexOf("END:VFREEBUSY");
  if (fbStart === -1 || fbEnd === -1) {
    return events;
  }

  const fbBlock = unfolded.substring(fbStart, fbEnd);

  // Find all FREEBUSY lines — must reset lastIndex for global regex
  FREEBUSY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FREEBUSY_PATTERN.exec(fbBlock)) !== null) {
    const rawValue = match[1].trim();

    // Extract FBTYPE from parameters if present
    let fbType = "BUSY"; // default per RFC 4791
    let periodsStr = rawValue;

    // If the raw match contains parameters (e.g. "FBTYPE=BUSY:periods"),
    // split on the colon that separates params from value.
    const colonIdx = rawValue.indexOf(":");
    if (colonIdx >= 0 && rawValue.includes("=")) {
      // Has parameters before the colon
      const params = rawValue.substring(0, colonIdx);
      periodsStr = rawValue.substring(colonIdx + 1).trim();

      // Extract FBTYPE
      const fbTypeMatch = /FBTYPE=([A-Z-]+)/.exec(params);
      if (fbTypeMatch) {
        fbType = fbTypeMatch[1];
      }
    }

    // Parse comma-separated periods
    const periods = periodsStr.split(",");
    for (const period of periods) {
      const trimmed = period.trim();
      if (trimmed === "") {
        continue;
      }

      const slashIdx = trimmed.indexOf("/");
      if (slashIdx === -1) {
        console.warn("Invalid FREEBUSY period (no slash):", trimmed);
        continue;
      }

      const startStr = trimmed.substring(0, slashIdx);
      const endOrDuration = trimmed.substring(slashIdx + 1);

      const date = parseICalDate(startStr);
      const startTime = parseICalTime(startStr);

      if (date === null) {
        console.warn(
          "Could not parse date from FREEBUSY period:",
          startStr
        );
        continue;
      }

      let endTime: string | null;
      let endDate: string;
      if (endOrDuration.startsWith("P")) {
        // ISO 8601 duration like PT1H, PT30M, PT1H30M
        endTime = parseDurationEndTime(startTime, endOrDuration);
        endDate = computeEndDate(startStr, null, endOrDuration, date);
      } else {
        endTime = parseICalTime(endOrDuration);
        // The period end is exclusive, so a block ending at midnight does not
        // occupy the following day.
        endDate = computeEndDate(startStr, endOrDuration, null, date);
      }

      events.push(
        makeEvent(null, date, endDate, startTime, endTime, fbType, false)
      );
    }
  }

  return events;
}

// ─── Helper functions ────────────────────────────────────────────────────────

/**
 * Extracts an iCalendar property value from a VEVENT block.
 * Handles property parameters like DTSTART;VALUE=DATE:20250210.
 *
 * Ported from: CalDavClient.java extractICalProperty() lines 494-507
 */
export function extractICalProperty(
  block: string,
  pattern: RegExp
): string | null {
  // Reset lastIndex for non-global patterns that might be reused
  const regex = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const match = regex.exec(block);
  if (match) {
    const value = match[1];
    // Handle property parameters like DTSTART;VALUE=DATE:20250210
    const colonIdx = value.indexOf(":");
    if (colonIdx >= 0 && value.includes("=")) {
      // Has parameters before the colon
      return value.substring(colonIdx + 1).trim();
    }
    return value.trim();
  }
  return null;
}

/**
 * Parses an iCalendar date/datetime string into an ISO date string "YYYY-MM-DD".
 * Supports formats: 20250210, 20250210T140000, 20250210T140000Z.
 *
 * Ported from: CalDavClient.java parseICalDate() lines 629-640
 */
export function parseICalDate(dtValue: string): string | null {
  try {
    // Strip timezone suffix
    const clean = dtValue.replace("Z", "").trim();
    if (clean.length >= 8) {
      const year = clean.substring(0, 4);
      const month = clean.substring(4, 6);
      const day = clean.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
  } catch {
    console.warn("Failed to parse iCal date:", dtValue);
  }
  return null;
}

/**
 * Parses an iCalendar datetime string into an "HH:mm" time string.
 * Returns null for date-only values (all-day events).
 * Supports formats: 20250210T140000, 20250210T140000Z.
 *
 * Ported from: CalDavClient.java parseICalTime() lines 647-661
 */
export function parseICalTime(dtValue: string): string | null {
  try {
    const clean = dtValue.replace("Z", "").trim();
    if (clean.includes("T") && clean.length >= 15) {
      const timeStr = clean.substring(9); // HHmmss
      const hours = timeStr.substring(0, 2);
      const minutes = timeStr.substring(2, 4);
      return `${hours}:${minutes}`;
    }
  } catch {
    console.warn("Failed to parse iCal time:", dtValue);
  }
  return null;
}

/**
 * Calculates the end time by adding an ISO 8601 duration to a start time.
 * Supports simple durations like PT1H, PT30M, PT1H30M.
 * Returns null if the start time is null or the duration cannot be parsed.
 *
 * Ported from: CalDavClient.java parseDurationEndTime() lines 612-623
 */
export function parseDurationEndTime(
  startTime: string | null,
  duration: string
): string | null {
  if (startTime === null) {
    return null;
  }

  const durationMinutes = parseDurationMinutes(duration);
  if (durationMinutes === null) {
    return null;
  }

  // Wrap into the day of the end instant; the day span is tracked separately
  // via the event's endDate.
  const totalMinutes = parseTimeToMinutes(startTime) + durationMinutes;
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  return formatMinutesToTime(wrapped);
}

/**
 * Formats a date string "YYYY-MM-DD" into iCalendar date format "yyyyMMdd".
 *
 * Ported from: CalDavClient.java ICAL_DATE_FORMATTER (line 258)
 */
export function formatICalDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/**
 * Extracts a display name from an ORGANIZER/ATTENDEE property's parameters
 * and value, preferring the CN (common name) parameter over the raw
 * "mailto:" value.
 */
function extractDisplayName(params: string, value: string): string {
  const cnMatch = /CN=(?:"([^"]*)"|([^;]+))/.exec(params);
  if (cnMatch) {
    return (cnMatch[1] ?? cnMatch[2]).trim();
  }
  const mailtoMatch = /^mailto:(.+)$/i.exec(value.trim());
  if (mailtoMatch) {
    return mailtoMatch[1].trim();
  }
  return value.trim();
}

/**
 * Extracts the organizer's display name from a VEVENT block, or null if
 * no ORGANIZER property is present.
 */
function extractOrganizer(block: string): string | null {
  const regex = new RegExp(ORGANIZER_PATTERN.source, "m");
  const match = regex.exec(block);
  if (!match) return null;
  return extractDisplayName(match[1], match[2]);
}

/**
 * Extracts the display names of all attendees from a VEVENT block.
 * A VEVENT may contain multiple ATTENDEE lines, one per participant.
 */
function extractAttendees(block: string): string[] {
  const regex = new RegExp(ATTENDEE_PATTERN.source, ATTENDEE_PATTERN.flags);
  const attendees: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(block)) !== null) {
    attendees.push(extractDisplayName(match[1], match[2]));
  }
  return attendees;
}

/**
 * Unescapes iCalendar TEXT value escape sequences (RFC 5545 §3.3.11):
 * "\n"/"\N" → newline, "\," → ",", "\;" → ";", "\\\\" → "\\".
 */
function unescapeICalText(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
