/**
 * Top toolbar with application title, connection status, and connect button.
 *
 * Ported from: CalDavView.java constructor toolbar section (lines 153-164)
 *              CalDavView.java updateConnectionStatus() (lines 830-842)
 *
 * Features:
 * - Left: "Planner" title
 * - Right: help + about buttons, connection status text + Connect/Reconnect button
 * - Connection status color: gray when disconnected, green when connected
 */

import {
  connected,
  connection,
  showLoginDialog,
  disconnect,
  initializing,
} from "../state/app-state.js";

export interface ToolbarProps {
  onOpenHelp: () => void;
  onOpenAbout: () => void;
}

export function Toolbar({ onOpenHelp, onOpenAbout }: ToolbarProps) {
  const isConnected = connected.value;
  const username = connection.value?.username;

  const handleConnect = () => {
    showLoginDialog.value = true;
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <div class="toolbar">
      <h1 class="toolbar-title">Terminplaner</h1>
      <div class="toolbar-actions">
        <button
          class="btn btn-tertiary btn-small toolbar-icon-btn"
          onClick={onOpenHelp}
          title="Hilfe"
          type="button"
        >
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"
            />
          </svg>
        </button>
        <button
          class="btn btn-tertiary btn-small toolbar-icon-btn"
          onClick={onOpenAbout}
          title="Info"
          type="button"
        >
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
            />
          </svg>
        </button>
        <span
          class="connection-status"
          style={{
            color: isConnected
              ? "var(--cv-success-text)"
              : "var(--cv-text-secondary)",
          }}
        >
          {initializing.value
            ? "Verbinde…"
            : isConnected
              ? `Verbunden als ${username}`
              : "Nicht verbunden"}
        </span>
        {isConnected ? (
          <button
            class="btn btn-secondary btn-small"
            onClick={handleDisconnect}
          >
            Trennen
          </button>
        ) : (
          <button class="btn btn-primary" onClick={handleConnect}>
            Verbinden
          </button>
        )}
      </div>
    </div>
  );
}
