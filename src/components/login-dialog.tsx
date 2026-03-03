/**
 * Modal login dialog for connecting to a CalDAV server.
 *
 * Ported from: CalDavView.java openLoginDialog() lines 726-808
 *
 * Features:
 * - Fields: URL (pre-filled with default), Username, Password
 * - Buttons: Connect, Cancel (Cancel only visible if already connected)
 * - "Connecting..." state on button while request is in flight
 * - Auto-focus logic: first empty field gets focus
 * - Pure HTML/CSS modal overlay (no library)
 */

import { useRef, useEffect, useState } from "preact/hooks";
import { DEFAULT_CALDAV_URL } from "../services/http.js";
import {
  showLoginDialog,
  connected,
  connection,
  connect,
  acceptInvalidCerts,
  initializing,
} from "../state/app-state.js";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
} from "../services/credential-store.js";

/**
 * Notification callback type for showing toast messages from the dialog.
 */
export interface LoginDialogProps {
  onNotification?: (
    message: string,
    variant: "success" | "warning" | "error"
  ) => void;
}

export function LoginDialog({ onNotification }: LoginDialogProps) {
  const urlRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [connecting, setConnecting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // When the dialog becomes visible, check if we have saved credentials
  // to pre-set the "remember me" checkbox state
  useEffect(() => {
    if (!showLoginDialog.value) return;
    loadCredentials().then((saved) => {
      if (saved) setRememberMe(true);
    });
  }, [showLoginDialog.value]);

  // Auto-focus the first empty field when dialog opens
  useEffect(() => {
    if (!showLoginDialog.value) return;

    // Use requestAnimationFrame to ensure the dialog is rendered before focusing
    requestAnimationFrame(() => {
      if (urlRef.current && !urlRef.current.value) {
        urlRef.current.focus();
      } else if (usernameRef.current && !usernameRef.current.value) {
        usernameRef.current.focus();
      } else if (passwordRef.current) {
        passwordRef.current.focus();
      }
    });
  }, [showLoginDialog.value]);

  if (initializing.value || !showLoginDialog.value) {
    return null;
  }

  const handleConnect = async () => {
    const url = urlRef.current?.value ?? "";
    const username = usernameRef.current?.value ?? "";
    const password = passwordRef.current?.value ?? "";

    if (!url.trim() || !username.trim() || !password.trim()) {
      onNotification?.("Bitte alle Felder ausfüllen.", "warning");
      return;
    }

    setConnecting(true);
    const error = await connect(url.trim(), username.trim(), password);
    setConnecting(false);

    if (error) {
      onNotification?.(error, "error");
    } else {
      // Persist or clear credentials based on checkbox
      if (rememberMe) {
        await saveCredentials({ url: url.trim(), username: username.trim(), password, acceptInvalidCerts: acceptInvalidCerts.value });
      } else {
        await clearCredentials();
      }
      onNotification?.(
        "Verbindung erfolgreich. Sie können jetzt nach Benutzern suchen.",
        "success"
      );
    }
  };

  const handleCancel = () => {
    showLoginDialog.value = false;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !connecting) {
      handleConnect();
    }
    if (e.key === "Escape" && connected.value) {
      handleCancel();
    }
  };

  // Pre-fill values from existing connection or defaults
  const defaultUrl = connection.value?.url ?? DEFAULT_CALDAV_URL;
  const defaultUsername = connection.value?.username ?? "";

  return (
    <div class="login-overlay" onKeyDown={handleKeyDown}>
      <div class="login-dialog">
        <div class="login-dialog-header">
          <h2>Mit CalDAV-Server verbinden</h2>
        </div>

        <div class="login-dialog-body">
          <div class="form-field">
            <label for="login-url">CalDAV-URL</label>
            <input
              ref={urlRef}
              id="login-url"
              type="text"
              defaultValue={defaultUrl}
              placeholder="https://..."
              disabled={connecting}
            />
          </div>

          <div class="form-field">
            <label for="login-username">Benutzername</label>
            <input
              ref={usernameRef}
              id="login-username"
              type="text"
              defaultValue={defaultUsername}
              placeholder="Benutzername"
              disabled={connecting}
            />
          </div>

          <div class="form-field">
            <label for="login-password">Passwort</label>
            <input
              ref={passwordRef}
              id="login-password"
              type="password"
              placeholder="Passwort"
              disabled={connecting}
            />
          </div>

          <div class="form-field form-field-checkbox">
            <label for="login-accept-invalid-certs">
              <input
                id="login-accept-invalid-certs"
                type="checkbox"
                checked={acceptInvalidCerts.value}
                onChange={(e) => {
                  acceptInvalidCerts.value =
                    (e.target as HTMLInputElement).checked;
                }}
                disabled={connecting}
              />
              Ungültige TLS-Zertifikate akzeptieren
            </label>
            <span class="form-hint">
              Aktivieren, wenn der Server ein selbstsigniertes oder
              unvollständiges Zertifikat verwendet.
            </span>
          </div>

          <div class="form-field form-field-checkbox">
            <label for="login-remember-me">
              <input
                id="login-remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => {
                  setRememberMe((e.target as HTMLInputElement).checked);
                }}
                disabled={connecting}
              />
              Anmeldedaten merken
            </label>
            <span class="form-hint">
              Anmeldedaten werden sicher im Betriebssystem gespeichert.
            </span>
          </div>
        </div>

        <div class="login-dialog-footer">
          {connected.value && (
            <button
              class="btn btn-secondary"
              onClick={handleCancel}
              disabled={connecting}
            >
              Abbrechen
            </button>
          )}
          <button
            class="btn btn-primary"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? "Verbinde..." : "Verbinden"}
          </button>
        </div>
      </div>
    </div>
  );
}
