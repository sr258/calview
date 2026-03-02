/**
 * Favorites persistence using localStorage.
 *
 * Stores a per-server list of favorited CalDAV users so they can be
 * quickly added to the schedule grid without searching.
 *
 * Storage schema (JSON in localStorage):
 *   { [serverUrl: string]: Array<{ displayName: string; href: string }> }
 *
 * Favorites are keyed by server URL so that different CalDAV servers
 * maintain independent favorites lists.
 *
 * Not stored in the OS keychain because favorites are not sensitive —
 * they only contain display names and principal hrefs.
 */

import type { CalDavUser } from "../model/types.js";

const LOCAL_STORAGE_KEY = "calview_favorites";

/** Internal shape of the full persisted map. */
type FavoritesMap = Record<string, CalDavUser[]>;

/**
 * Read the full favorites map from localStorage.
 */
function readAll(): FavoritesMap {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as FavoritesMap;
  } catch {
    return {};
  }
}

/**
 * Write the full favorites map to localStorage.
 */
function writeAll(map: FavoritesMap): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable (e.g. private browsing); silently ignore
  }
}

/**
 * Load the favorites list for a specific server URL.
 * Returns an empty array if no favorites exist for that server.
 */
export function loadFavorites(serverUrl: string): CalDavUser[] {
  const map = readAll();
  const list = map[serverUrl];
  if (!Array.isArray(list)) return [];

  // Validate entries — only keep objects with displayName and href
  return list.filter(
    (u) =>
      u !== null &&
      typeof u === "object" &&
      typeof u.displayName === "string" &&
      typeof u.href === "string"
  );
}

/**
 * Save the favorites list for a specific server URL.
 * Replaces the entire list for that server.
 * If the list is empty, removes the server key entirely.
 */
export function saveFavorites(serverUrl: string, favorites: CalDavUser[]): void {
  const map = readAll();
  if (favorites.length === 0) {
    delete map[serverUrl];
  } else {
    // Only persist the fields we need (displayName, href)
    map[serverUrl] = favorites.map((u) => ({
      displayName: u.displayName,
      href: u.href,
    }));
  }
  writeAll(map);
}
