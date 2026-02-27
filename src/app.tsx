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
 * On mount: if not connected, the login dialog is already shown
 * (showLoginDialog starts as true in app-state.ts).
 */

import { useState, useCallback } from "preact/hooks";
import { Toolbar } from "./components/toolbar.js";
import { LoginDialog } from "./components/login-dialog.js";
import { UserSearch } from "./components/user-search.js";
import { WeekNavigator } from "./components/week-navigator.js";
import { ScheduleGrid } from "./components/schedule-grid.js";
import { Notifications, type NotificationVariant } from "./components/notifications.js";

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
