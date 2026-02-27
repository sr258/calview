/**
 * Top toolbar with application title, connection status, and connect button.
 *
 * Ported from: CalDavView.java constructor toolbar section (lines 153-164)
 *              CalDavView.java updateConnectionStatus() (lines 830-842)
 *
 * Features:
 * - Left: "Planner" title
 * - Right: connection status text + Connect/Reconnect button
 * - Connection status color: gray when disconnected, green when connected
 */

import {
  connected,
  connection,
  showLoginDialog,
  disconnect,
} from "../state/app-state.js";

export function Toolbar() {
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
      <h1 class="toolbar-title">Planner</h1>
      <div class="toolbar-actions">
        <span
          class="connection-status"
          style={{
            color: isConnected
              ? "var(--cv-success-text)"
              : "var(--cv-text-secondary)",
          }}
        >
          {isConnected ? `Connected as ${username}` : "Not connected"}
        </span>
        {isConnected && (
          <button
            class="btn btn-secondary btn-small"
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        )}
        <button class="btn btn-primary" onClick={handleConnect}>
          {isConnected ? "Reconnect" : "Connect"}
        </button>
      </div>
    </div>
  );
}
