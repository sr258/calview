/**
 * Simple toast notification system.
 *
 * Ported from: Vaadin Notification usage throughout CalDavView.java
 * (e.g., lines 758-760, 779-781, 783-784, 338-341)
 *
 * Features:
 * - Toast container positioned at bottom-center
 * - Variants: success (green), warning (yellow), error (red)
 * - Auto-dismiss managed by parent (App component)
 * - Click to dismiss
 */

export type NotificationVariant = "success" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  variant: NotificationVariant;
}

interface NotificationsProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function Notifications({ toasts, onDismiss }: NotificationsProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div class="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          class={`toast toast-${toast.variant}`}
          onClick={() => onDismiss(toast.id)}
          role="alert"
        >
          <span class="toast-message">{toast.message}</span>
          <button
            class="toast-close"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(toast.id);
            }}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
