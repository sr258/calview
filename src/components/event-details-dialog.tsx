/**
 * Read-only details popup for an existing calendar appointment.
 *
 * Shown when the user clicks on a busy slot / event block, instead of
 * opening the "new appointment" dialog. Uses the same overlay/dialog
 * pattern as LoginDialog / OutlookMockDialog for visual consistency.
 */

import { useEffect } from "preact/hooks";
import type { EventWithOwner } from "../model/types.js";
import { formatTimeForDisplay } from "../model/schedule.js";

export interface EventDetailsDialogProps {
  /** The event(s) to display (each paired with its calendar owner), or null to hide the dialog. */
  entries: EventWithOwner[] | null;
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

function EventDetailsEntry({ user, event }: EventWithOwner) {
  const timeRange =
    event.startTime && event.endTime
      ? `${formatTimeForDisplay(event.startTime)} – ${formatTimeForDisplay(event.endTime)} Uhr`
      : "Ganztägig";

  return (
    <div class="outlook-mock-field-group">
      <div class="outlook-mock-field">
        <span class="outlook-mock-label">Kalender von:</span>
        <span class="outlook-mock-value">{user.displayName}</span>
      </div>

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

      {event.location && (
        <div class="outlook-mock-field">
          <span class="outlook-mock-label">Ort:</span>
          <span class="outlook-mock-value">{event.location}</span>
        </div>
      )}

      {event.organizer && (
        <div class="outlook-mock-field">
          <span class="outlook-mock-label">Organisator:</span>
          <span class="outlook-mock-value">{event.organizer}</span>
        </div>
      )}

      {event.attendees && event.attendees.length > 0 && (
        <div class="outlook-mock-field">
          <span class="outlook-mock-label">Teilnehmer:</span>
          <span class="outlook-mock-value">{event.attendees.join(", ")}</span>
        </div>
      )}

      {event.description && (
        <div class="outlook-mock-field">
          <span class="outlook-mock-label">Beschreibung:</span>
          <span class="outlook-mock-value outlook-mock-value-multiline">{event.description}</span>
        </div>
      )}

      {event.accessible && !event.organizer && (!event.attendees || event.attendees.length === 0) && (
        <div class="outlook-mock-hint">
          Für diesen Termin sind keine weiteren Details (Organisator, Teilnehmer, Ort,
          Beschreibung) im Kalender hinterlegt.
        </div>
      )}

      {!event.accessible && (
        <div class="outlook-mock-hint">
          Für diesen Kalender ist nur die Frei/Belegt-Zeit sichtbar — Betreff,
          Organisator, Teilnehmer und weitere Details liegen nicht vor.
        </div>
      )}
    </div>
  );
}

export function EventDetailsDialog({ entries, onClose }: EventDetailsDialogProps) {
  const isOpen = !!entries && entries.length > 0;

  // Listen on the document rather than the dialog itself, since the dialog
  // has no focusable element to receive the keydown when it opens (focus
  // stays wherever it was, e.g. on the clicked table cell).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!entries || entries.length === 0) {
    return null;
  }

  const handleOverlayClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("login-overlay")) {
      onClose();
    }
  };

  return (
    <div class="login-overlay" onClick={handleOverlayClick}>
      <div class="login-dialog outlook-mock-dialog">
        <div class="login-dialog-header">
          <h2>Termindetails</h2>
        </div>

        <div class="login-dialog-body">
          {entries.map((entry, i) => (
            <EventDetailsEntry key={i} user={entry.user} event={entry.event} />
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
