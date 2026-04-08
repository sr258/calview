/**
 * Root application component.
 *
 * Ported from: CalDavView.java constructor (lines 130-218) and
 *              CalDavView.java onAttach() (lines 844-850)
 *
 * Renders the full component tree:
 * - Toolbar (top bar)
 * - LoginDialog (modal overlay when showLoginDialog is true)
 * - Main content: UserSearch, WeekNavigator, ScheduleGrid
 * - Notifications (toast container)
 *
 * On mount: checks for saved credentials and auto-connects if found.
 * If no saved credentials, the login dialog is shown after the check.
 */

import { useState, useCallback, useEffect } from "preact/hooks";
import { Toolbar } from "./components/toolbar.js";
import { LoginDialog } from "./components/login-dialog.js";
import { UserSearch } from "./components/user-search.js";
import { FavoritesList } from "./components/favorites-list.js";
import { WeekNavigator } from "./components/week-navigator.js";
import { ViewSwitcher } from "./components/view-switcher.js";
import { ScheduleGrid } from "./components/schedule-grid.js";
import { CalendarView } from "./components/calendar-view.js";
import { OutlookMockDialog } from "./components/outlook-mock-dialog.js";
import { Notifications, type NotificationVariant } from "./components/notifications.js";
import { initializeApp, activeView } from "./state/app-state.js";
import {
  openOutlookAppointment,
  type OutlookAppointmentParams,
  type OutlookFormattedParams,
} from "./services/outlook.js";

interface ToastMessage {
  id: number;
  message: string;
  variant: NotificationVariant;
}

let nextToastId = 0;

export function App() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [mockDialogParams, setMockDialogParams] = useState<OutlookFormattedParams | null>(null);

  const showNotification = useCallback(
    (message: string, variant: NotificationVariant) => {
      const id = nextToastId++;
      setToasts((prev) => [...prev, { id, message, variant }]);

      // Auto-remove after duration
      const duration = variant === "error" ? 5000 : 3000;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    []
  );

  // On mount, check for saved credentials and auto-login.
  // This runs before the login dialog is ever shown, so there is no flash.
  useEffect(() => {
    initializeApp().then((result) => {
      if (result.status === "success") {
        showNotification(
          "Verbindung erfolgreich. Sie können jetzt nach Benutzern suchen.",
          "success"
        );
      } else if (result.status === "failed") {
        showNotification(
          `Automatische Anmeldung fehlgeschlagen: ${result.message}`,
          "warning"
        );
      }
    });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Handle slot click: open Outlook appointment or show mock dialog. */
  const handleSlotClick = useCallback(
    async (params: OutlookAppointmentParams) => {
      const result = await openOutlookAppointment(params);
      switch (result.type) {
        case "show_mock":
          setMockDialogParams(result.params);
          break;
        case "tauri_success":
          showNotification(result.message, "success");
          break;
        case "tauri_error":
          showNotification(`Outlook-Fehler: ${result.message}`, "error");
          break;
      }
    },
    [showNotification],
  );

  return (
    <div class="app-root">
      <Toolbar />

      <LoginDialog onNotification={showNotification} />

      <div class="app-content">
        <UserSearch />
        <FavoritesList />
        <div class="week-nav-row">
          <WeekNavigator />
          <ViewSwitcher />
        </div>
        {activeView.value === "table"
          ? <ScheduleGrid onSlotClick={handleSlotClick} />
          : <CalendarView onSlotClick={handleSlotClick} />}
      </div>

      <OutlookMockDialog
        params={mockDialogParams}
        onClose={() => setMockDialogParams(null)}
      />

      <Notifications toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
