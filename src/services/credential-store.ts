/**
 * Credential persistence abstraction.
 *
 * - In Tauri (production): stores credentials in the OS keychain via
 *   custom Tauri commands that wrap the `keyring` Rust crate.
 * - In browser (development): falls back to localStorage.
 *
 * Credentials are stored as { url, authHeader } where authHeader is the
 * HTTP Basic Auth value ("Basic <base64(username:password)>"). This avoids
 * storing the raw password — the password is only present in its
 * base64-encoded form inside the auth header.
 */

import type { ConnectionInfo } from "../model/types.js";
import { isTauri, buildBasicAuthHeader } from "./http.js";

const LOCAL_STORAGE_KEY = "calview_credentials";

/** Shape of what we persist (not the same as ConnectionInfo). */
interface StoredCredentials {
  url: string;
  authHeader: string;
  acceptInvalidCerts: boolean;
}

/**
 * Decode a Basic Auth header back into username and password.
 * Splits on the first ":" so passwords containing ":" are handled correctly.
 */
function decodeBasicAuth(authHeader: string): { username: string; password: string } | null {
  // "Basic <base64>" -> extract the base64 part
  const match = authHeader.match(/^Basic\s+(.+)$/);
  if (!match) return null;

  try {
    const decoded = atob(match[1]);
    const colonIndex = decoded.indexOf(":");
    if (colonIndex < 0) return null;
    return {
      username: decoded.substring(0, colonIndex),
      password: decoded.substring(colonIndex + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Convert stored credentials back to ConnectionInfo.
 */
function toConnectionInfo(stored: StoredCredentials): ConnectionInfo | null {
  const decoded = decodeBasicAuth(stored.authHeader);
  if (!decoded) return null;
  return {
    url: stored.url,
    username: decoded.username,
    password: decoded.password,
    acceptInvalidCerts: stored.acceptInvalidCerts ?? false,
  };
}

/**
 * Save credentials to persistent storage.
 */
export async function saveCredentials(conn: ConnectionInfo): Promise<void> {
  const authHeader = buildBasicAuthHeader(conn.username, conn.password);

  const acceptCerts = conn.acceptInvalidCerts ?? false;

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_credentials", { url: conn.url, authHeader, acceptInvalidCerts: acceptCerts });
  } else {
    try {
      const stored: StoredCredentials = { url: conn.url, authHeader, acceptInvalidCerts: acceptCerts };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // localStorage may be unavailable (e.g. private browsing); silently ignore
    }
  }
}

/**
 * Load credentials from persistent storage.
 * Returns null if no credentials are stored or if reading fails.
 */
export async function loadCredentials(): Promise<ConnectionInfo | null> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<StoredCredentials | null>("get_credentials");
      if (!result) return null;
      return toConnectionInfo(result);
    } catch {
      return null;
    }
  } else {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      const stored: StoredCredentials = JSON.parse(raw);
      if (!stored?.url || !stored?.authHeader) return null;
      return toConnectionInfo(stored);
    } catch {
      return null;
    }
  }
}

/**
 * Delete stored credentials from persistent storage.
 */
export async function clearCredentials(): Promise<void> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_credentials");
    } catch {
      // Ignore errors (e.g. no entry to delete)
    }
  } else {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // silently ignore
    }
  }
}
