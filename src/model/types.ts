/**
 * TypeScript data model — ported from Java records.
 *
 * Design note: Using plain date/time strings instead of Date objects
 * avoids timezone pitfalls. All CalDAV times are UTC; we parse them
 * to local display strings.
 * - Dates are ISO strings: "2025-02-10"
 * - Times are "HH:mm" strings: "14:00"
 */

/**
 * Represents a user (principal) discovered on a CalDAV server.
 *
 * Ported from: CalDavUser.java
 *
 * @property displayName - the human-readable name of the user
 * @property href - the URL or path of the user's principal collection
 */
export interface CalDavUser {
  displayName: string;
  href: string;
}

/**
 * Represents an event (appointment) from a CalDAV calendar.
 *
 * Ported from: CalDavEvent.java
 *
 * @property summary - the name/summary of the event, or null if the calendar is restricted
 * @property date - the date of the event as ISO string "YYYY-MM-DD"
 * @property startTime - the start time as "HH:mm", or null for all-day events
 * @property endTime - the end time as "HH:mm", or null for all-day events
 * @property status - the visibility/class of the event (e.g. "PUBLIC", "PRIVATE", "CONFIDENTIAL",
 *                    "BUSY", "BUSY-TENTATIVE", "BUSY-UNAVAILABLE")
 * @property accessible - whether the event details are visible to the current user
 */
export interface CalDavEvent {
  summary: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  accessible: boolean;
}

/**
 * Represents the display state of a single cell in the schedule grid.
 *
 * Ported from: CalDavView.SlotInfo (inner record)
 *
 * @property cssClass - the CSS class to apply to the cell
 * @property label - short text to display in the cell (may be null)
 * @property tooltip - tooltip text (may be null)
 * @property busy - whether this slot is considered busy (used for "All Free" calculation)
 */
export interface SlotInfo {
  cssClass: string;
  label: string | null;
  tooltip: string | null;
  busy: boolean;
}

/**
 * Represents a single row in the schedule grid.
 *
 * Ported from: CalDavView.ScheduleRow (inner record)
 *
 * @property user - the user for this row, or null for the "All Free" summary row
 * @property slots - map of slot key (e.g. "0-07:00") to slot info
 */
export interface ScheduleRow {
  user: CalDavUser | null;
  slots: Record<string, SlotInfo>;
}

/**
 * Stores connection credentials for the CalDAV server.
 *
 * Ported from: implicit fields in CalDavView.java (connectedUrl, connectedUsername, connectedPassword)
 */
export interface ConnectionInfo {
  url: string;
  username: string;
  password: string;
}

/**
 * Exception thrown when a CalDAV operation fails.
 *
 * Ported from: CalDavException.java
 */
export class CalDavError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CalDavError";
  }
}
