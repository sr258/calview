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
  console.log("[credential-store] saveCredentials: url=%s, user=%s, acceptInvalidCerts=%s, backend=%s",
    conn.url, conn.username, acceptCerts, isTauri() ? "tauri" : "localStorage");

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_credentials", { url: conn.url, authHeader, acceptInvalidCerts: acceptCerts });
      console.log("[credential-store] saveCredentials: Tauri invoke succeeded");
    } catch (e) {
      console.error("[credential-store] saveCredentials: Tauri invoke failed:", e);
      throw e;
    }
  } else {
    try {
      const stored: StoredCredentials = { url: conn.url, authHeader, acceptInvalidCerts: acceptCerts };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
      console.log("[credential-store] saveCredentials: localStorage write succeeded");
    } catch (e) {
      console.warn("[credential-store] saveCredentials: localStorage write failed:", e);
    }
  }
}

/**
 * Load credentials from persistent storage.
 * Returns null if no credentials are stored or if reading fails.
 */
export async function loadCredentials(): Promise<ConnectionInfo | null> {
  console.log("[credential-store] loadCredentials: backend=%s", isTauri() ? "tauri" : "localStorage");

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<StoredCredentials | null>("get_credentials");
      if (!result) {
        console.log("[credential-store] loadCredentials: no stored credentials found (Tauri)");
        return null;
      }
      console.log("[credential-store] loadCredentials: loaded from Tauri keychain — url=%s, acceptInvalidCerts=%s",
        result.url, result.acceptInvalidCerts);
      const conn = toConnectionInfo(result);
      if (!conn) {
        console.warn("[credential-store] loadCredentials: failed to decode authHeader from stored credentials");
      } else {
        console.log("[credential-store] loadCredentials: decoded user=%s", conn.username);
      }
      return conn;
    } catch (e) {
      console.error("[credential-store] loadCredentials: Tauri invoke failed:", e);
      return null;
    }
  } else {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) {
        console.log("[credential-store] loadCredentials: no stored credentials in localStorage");
        return null;
      }
      const stored: StoredCredentials = JSON.parse(raw);
      if (!stored?.url || !stored?.authHeader) {
        console.warn("[credential-store] loadCredentials: stored data missing url or authHeader:", stored);
        return null;
      }
      console.log("[credential-store] loadCredentials: loaded from localStorage — url=%s, acceptInvalidCerts=%s",
        stored.url, stored.acceptInvalidCerts);
      const conn = toConnectionInfo(stored);
      if (!conn) {
        console.warn("[credential-store] loadCredentials: failed to decode authHeader from stored credentials");
      } else {
        console.log("[credential-store] loadCredentials: decoded user=%s", conn.username);
      }
      return conn;
    } catch (e) {
      console.error("[credential-store] loadCredentials: failed to read/parse localStorage:", e);
      return null;
    }
  }
}

/**
 * Delete stored credentials from persistent storage.
 */
export async function clearCredentials(): Promise<void> {
  console.log("[credential-store] clearCredentials: backend=%s", isTauri() ? "tauri" : "localStorage");

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_credentials");
      console.log("[credential-store] clearCredentials: Tauri delete succeeded");
    } catch (e) {
      console.warn("[credential-store] clearCredentials: Tauri delete failed:", e);
    }
  } else {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      console.log("[credential-store] clearCredentials: localStorage removed");
    } catch (e) {
      console.warn("[credential-store] clearCredentials: localStorage remove failed:", e);
    }
  }
}
