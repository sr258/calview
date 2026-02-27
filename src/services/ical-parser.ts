/**
 * iCalendar text parser — regex-based, ported directly from CalDavClient.java.
 *
 * Parses raw iCalendar (RFC 5545) text into CalDavEvent records.
 * Uses the same regex approach as the Java code rather than a library.
 *
 * Ported from: CalDavClient.java lines 420-661
 */

import type { CalDavEvent } from "../model/types.js";

// ─── iCalendar property patterns ─────────────────────────────────────────────
// Ported from CalDavClient.java lines 421-426

const SUMMARY_PATTERN = /^SUMMARY[;:](.*)/m;
const DTSTART_PATTERN = /^DTSTART[;:](.*)/m;
const DTEND_PATTERN = /^DTEND[;:](.*)/m;
const DURATION_PATTERN = /^DURATION[;:](.*)/m;
const CLASS_PATTERN = /^CLASS[;:](.*)/m;
const FREEBUSY_PATTERN = /^FREEBUSY[;:](.*)/gm;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parses raw iCalendar text data into CalDavEvent records.
 * Handles VEVENT blocks, extracts SUMMARY, DTSTART, DTEND (or DURATION), and CLASS.
 *
 * When DTEND is not present but DURATION is, the end time is computed
 * from DTSTART + DURATION. This is important for server-expanded recurring
 * events, which may use DURATION instead of DTEND.
 *
 * Ported from: CalDavClient.java parseICalendarData() lines 436-492
 */
export function parseICalendarData(
  icalData: string,
  accessible: boolean
): CalDavEvent[] {
  const events: CalDavEvent[] = [];

  // Unfold lines: iCal spec says lines can be folded with CRLF + whitespace
  const unfolded = icalData.replace(/\r?\n[ \t]/g, "");

  // Split into VEVENT blocks
  let veventStart = 0;
  while ((veventStart = unfolded.indexOf("BEGIN:VEVENT", veventStart)) !== -1) {
    const veventEnd = unfolded.indexOf("END:VEVENT", veventStart);
    if (veventEnd === -1) {
      break;
    }

    const veventBlock = unfolded.substring(veventStart, veventEnd);

    const summary = extractICalProperty(veventBlock, SUMMARY_PATTERN);
    const dtstart = extractICalProperty(veventBlock, DTSTART_PATTERN);
    const dtend = extractICalProperty(veventBlock, DTEND_PATTERN);
    const duration = extractICalProperty(veventBlock, DURATION_PATTERN);
    const classValue = extractICalProperty(veventBlock, CLASS_PATTERN);

    if (dtstart === null) {
      veventStart = veventEnd + 1;
      continue;
    }

    const date = parseICalDate(dtstart);
    const startTime = parseICalTime(dtstart);
    let endTime = dtend !== null ? parseICalTime(dtend) : null;

    // Fall back to DURATION if DTEND is not present
    if (endTime === null && duration !== null && startTime !== null) {
      endTime = parseDurationEndTime(startTime, duration.trim());
    }

    const status = classValue !== null ? classValue.trim() : "PUBLIC";

    if (date === null) {
      veventStart = veventEnd + 1;
      continue;
    }

    if (accessible) {
      events.push({
        summary: summary !== null ? summary.trim() : "(No title)",
        date,
        startTime,
        endTime,
        status,
        accessible: true,
      });
    } else {
      // For restricted calendars, hide the name
      events.push({
        summary: null,
        date,
        startTime,
        endTime,
        status,
        accessible: false,
      });
    }

    veventStart = veventEnd + 1;
  }

  return events;
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
      if (endOrDuration.startsWith("P")) {
        // ISO 8601 duration like PT1H, PT30M, PT1H30M
        endTime = parseDurationEndTime(startTime, endOrDuration);
      } else {
        endTime = parseICalTime(endOrDuration);
      }

      events.push({
        summary: null,
        date,
        startTime,
        endTime,
        status: fbType,
        accessible: false,
      });
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

  try {
    // Parse the start time "HH:mm" into minutes
    const [startHours, startMinutes] = startTime.split(":").map(Number);
    let totalMinutes = startHours * 60 + startMinutes;

    // Parse ISO 8601 duration: PT1H, PT30M, PT1H30M
    const durationMatch = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
      duration
    );
    if (!durationMatch) {
      console.warn("Failed to parse duration:", duration);
      return null;
    }

    const durationHours = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
    const durationMinutes = durationMatch[2]
      ? parseInt(durationMatch[2], 10)
      : 0;

    totalMinutes += durationHours * 60 + durationMinutes;

    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;

    return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
  } catch {
    console.warn("Failed to parse duration:", duration);
    return null;
  }
}

/**
 * Formats a date string "YYYY-MM-DD" into iCalendar date format "yyyyMMdd".
 *
 * Ported from: CalDavClient.java ICAL_DATE_FORMATTER (line 258)
 */
export function formatICalDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}
