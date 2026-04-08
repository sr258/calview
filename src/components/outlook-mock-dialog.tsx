/**
 * Mock dialog for Outlook appointment preview in browser dev mode.
 *
 * When running outside Tauri (e.g. in the Vite dev server), clicking
 * a time slot shows this dialog instead of invoking Outlook. It displays
 * the exact parameters that would be passed to the Outlook COM automation,
 * allowing frontend development and testing without Windows/Outlook.
 *
 * Uses the same overlay/dialog pattern as LoginDialog for visual consistency.
 */

import type { OutlookFormattedParams } from "../services/outlook.js";

interface OutlookMockDialogProps {
  /** The parameters to display, or null to hide the dialog. */
  params: OutlookFormattedParams | null;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}

/**
 * Format a start string "YYYY-MM-DD HH:mm" into a more readable German format.
 */
function formatStartForDisplay(start: string): string {
  try {
    // "2026-04-13 14:00" -> parse manually
    const [datePart, timePart] = start.split(" ");
    const [year, month, day] = datePart.split("-");
    const weekday = getWeekdayName(datePart);
    return `${weekday}, ${day}.${month}.${year} um ${timePart} Uhr`;
  } catch {
    return start;
  }
}

function getWeekdayName(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00");
  const names = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  return names[date.getDay()] ?? "";
}

export function OutlookMockDialog({ params, onClose }: OutlookMockDialogProps) {
  if (!params) {
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
          <h2>Outlook-Termin (Vorschau)</h2>
        </div>

        <div class="login-dialog-body">
          <div class="outlook-mock-field">
            <span class="outlook-mock-label">Betreff:</span>
            <span class="outlook-mock-value">
              {params.subject || "(leer)"}
            </span>
          </div>

          <div class="outlook-mock-field">
            <span class="outlook-mock-label">Start:</span>
            <span class="outlook-mock-value">
              {formatStartForDisplay(params.start)}
            </span>
          </div>

          <div class="outlook-mock-field">
            <span class="outlook-mock-label">Dauer:</span>
            <span class="outlook-mock-value">{params.duration} Minuten</span>
          </div>

          <div class="outlook-mock-field">
            <span class="outlook-mock-label">Teilnehmer:</span>
            <span class="outlook-mock-value">
              {params.attendees.length > 0
                ? params.attendees.join(", ")
                : "(keine)"}
            </span>
          </div>

          <div class="outlook-mock-hint">
            In der Desktop-App wird hier der Outlook-Termindialog
            mit diesen Daten geöffnet.
          </div>
          <div class="outlook-mock-hint outlook-mock-hint-future">
            Unter macOS und Linux wird diese Funktion
            zukünftig unterstützt (z.B. Thunderbird).
          </div>
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
