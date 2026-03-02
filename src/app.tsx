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
import { WeekNavigator } from "./components/week-navigator.js";
import { ScheduleGrid } from "./components/schedule-grid.js";
import { Notifications, type NotificationVariant } from "./components/notifications.js";
import { initializeApp } from "./state/app-state.js";

interface ToastMessage {
  id: number;
  message: string;
  variant: NotificationVariant;
}

let nextToastId = 0;

export function App() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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
          "Gespeicherte Anmeldedaten ungültig. Bitte erneut anmelden.",
          "warning"
        );
      }
    });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <div class="app-root">
      <Toolbar />

      <LoginDialog onNotification={showNotification} />

      <div class="app-content">
        <UserSearch />
        <WeekNavigator />
        <ScheduleGrid />
      </div>

      <Notifications toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
