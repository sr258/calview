/**
 * Outlook appointment integration service.
 *
 * - In Tauri (Windows): invokes the Rust backend command which spawns
 *   a PowerShell script to open the Outlook appointment dialog.
 * - In browser (dev): returns a "show_mock" result so the UI can
 *   display a mock dialog showing what would be sent to Outlook.
 * - On macOS/Linux in Tauri: PowerShell will fail to start; the error
 *   is returned to the frontend for display.
 *
 * Future: macOS/Linux could open Thunderbird or another mail client.
 */

import { isTauri } from "./http.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Parameters for creating an Outlook appointment from a slot click. */
export interface OutlookAppointmentParams {
  /** ISO date string "YYYY-MM-DD" */
  date: string;
  /** Hour of day (7-18), rounded to full hour */
  hour: number;
  /** Display names of all selected users (attendees) */
  attendees: string[];
}

/** The formatted parameters that would be sent to Outlook / shown in mock. */
export interface OutlookFormattedParams {
  subject: string;
  start: string;
  duration: number;
  attendees: string[];
}

/** Result from the Tauri backend command. */
interface TauriOutlookResult {
  status: string;
  message: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Discriminated union of possible outcomes. */
export type OutlookResult =
  | { type: "tauri_success"; message: string }
  | { type: "tauri_error"; message: string }
  | { type: "show_mock"; params: OutlookFormattedParams };

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Open an Outlook appointment dialog (Tauri) or return mock params (browser).
 *
 * The caller is responsible for handling the result:
 * - "show_mock": display the mock dialog with the returned params
 * - "tauri_success": show a success toast
 * - "tauri_error": show an error toast with the message
 */
export async function openOutlookAppointment(
  params: OutlookAppointmentParams,
): Promise<OutlookResult> {
  const start = `${params.date} ${String(params.hour).padStart(2, "0")}:00`;
  const formatted: OutlookFormattedParams = {
    subject: "",
    start,
    duration: 60,
    attendees: params.attendees,
  };

  console.log("[outlook] openOutlookAppointment called:", {
    date: params.date,
    hour: params.hour,
    start,
    attendeeCount: params.attendees.length,
    attendees: params.attendees,
    isTauri: isTauri(),
  });

  // In browser dev mode: return mock params for the preview dialog
  if (!isTauri()) {
    console.log("[outlook] Not running in Tauri — returning mock params for dialog");
    return { type: "show_mock", params: formatted };
  }

  // In Tauri: invoke the Rust backend command
  try {
    const { invoke } = await import("@tauri-apps/api/core");

    console.log("[outlook] Invoking Tauri command 'open_outlook_appointment'...");

    const result = await invoke<TauriOutlookResult>("open_outlook_appointment", {
      subject: formatted.subject,
      start: formatted.start,
      duration: formatted.duration,
      location: null,
      body: null,
      attendees: formatted.attendees,
    });

    console.log("[outlook] Tauri command result:", {
      status: result.status,
      message: result.message,
      exitCode: result.exitCode,
      stdout: result.stdout ? result.stdout.substring(0, 200) : "",
      stderr: result.stderr ? result.stderr.substring(0, 200) : "",
    });

    if (result.status === "error") {
      return { type: "tauri_error", message: result.message };
    }

    return {
      type: "tauri_success",
      message:
        result.status === "dialog_opened"
          ? "Outlook-Termindialog wird geöffnet..."
          : "Outlook-Skript erfolgreich ausgeführt.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[outlook] Tauri invoke failed:", msg);
    return { type: "tauri_error", message: msg };
  }
}
