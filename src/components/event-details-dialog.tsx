/**
 * Read-only details popup for an existing calendar appointment.
 *
 * Shown when the user clicks on a busy slot / event block, instead of
 * opening the "new appointment" dialog. Uses the same overlay/dialog
 * pattern as LoginDialog / OutlookMockDialog for visual consistency.
 */

import type { CalDavEvent } from "../model/types.js";
import { formatTimeForDisplay } from "../model/schedule.js";

export interface EventDetailsDialogProps {
  /** The event(s) to display, or null to hide the dialog. Multiple when several events overlap the clicked slot. */
  events: CalDavEvent[] | null;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}

function getWeekdayName(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00");
  const names = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  return names[date.getDay()] ?? "";
}

function formatDateForDisplay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${getWeekdayName(isoDate)}, ${day}.${month}.${year}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "BUSY-TENTATIVE":
      return "Vorläufig";
    case "BUSY-UNAVAILABLE":
      return "Abwesend";
    case "BUSY":
      return "Belegt";
    default:
      return status;
  }
}

function EventDetailsEntry({ event }: { event: CalDavEvent }) {
  const timeRange =
    event.startTime && event.endTime
      ? `${formatTimeForDisplay(event.startTime)} – ${formatTimeForDisplay(event.endTime)} Uhr`
      : "Ganztägig";

  return (
    <div class="outlook-mock-field-group">
      <div class="outlook-mock-field">
        <span class="outlook-mock-label">Betreff:</span>
        <span class="outlook-mock-value">
          {event.accessible ? event.summary || "(kein Betreff)" : "(nicht einsehbar)"}
        </span>
      </div>

      <div class="outlook-mock-field">
        <span class="outlook-mock-label">Datum:</span>
        <span class="outlook-mock-value">{formatDateForDisplay(event.date)}</span>
      </div>

      <div class="outlook-mock-field">
        <span class="outlook-mock-label">Zeit:</span>
        <span class="outlook-mock-value">{timeRange}</span>
      </div>

      <div class="outlook-mock-field">
        <span class="outlook-mock-label">Status:</span>
        <span class="outlook-mock-value">{statusLabel(event.status)}</span>
      </div>
    </div>
  );
}

export function EventDetailsDialog({ events, onClose }: EventDetailsDialogProps) {
  if (!events || events.length === 0) {
    return null;
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("login-overlay")) {
      onClose();
    }
  };

  return (
    <div class="login-overlay" onKeyDown={handleKeyDown} onClick={handleOverlayClick}>
      <div class="login-dialog outlook-mock-dialog">
        <div class="login-dialog-header">
          <h2>Termindetails</h2>
        </div>

        <div class="login-dialog-body">
          {events.map((event, i) => (
            <EventDetailsEntry key={i} event={event} />
          ))}
        </div>

        <div class="login-dialog-footer">
          <button class="btn btn-primary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
