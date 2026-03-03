/**
 * Centralized reactive application state using Preact Signals.
 *
 * Ported from: CalDavView.java instance fields (lines 63-128) and
 * action methods (addSelectedUser, removeSelectedUser, navigateWeek,
 * navigateToToday, fetchEventsForUser, refreshAllEvents, connect,
 * disconnect, searchUsersOnServer).
 *
 * Each piece of mutable state is a Preact Signal, which automatically
 * triggers re-renders in any component that reads it. Action functions
 * mutate signals and orchestrate async CalDAV operations.
 */

import { signal, computed, effect } from "@preact/signals";
import type {
  CalDavUser,
  CalDavEvent,
  ConnectionInfo,
  ScheduleRow,
} from "../model/types.js";
import { CalDavError } from "../model/types.js";
import {
  searchUsers as searchUsersOnServer,
  fetchWeekEvents,
} from "../services/caldav-client.js";
import {
  getMondayOfWeek,
  buildScheduleRows,
} from "../model/schedule.js";
import { setAcceptInvalidCerts } from "../services/http.js";
import { clearCredentials, loadCredentials } from "../services/credential-store.js";
import { loadFavorites, saveFavorites } from "../services/favorites-store.js";

// ─── Signals (Reactive State) ────────────────────────────────────────────────
// Ported from CalDavView.java instance fields lines 104-128

/**
 * 6.1 — Stores URL + credentials after successful login.
 * null when not connected.
 *
 * Ported from: CalDavView.java connectedUrl/connectedUsername/connectedPassword
 */
export const connection = signal<ConnectionInfo | null>(null);

/**
 * 6.2 — Whether login was successful.
 *
 * Ported from: CalDavView.java `connected` field (line 106)
 */
export const connected = signal<boolean>(false);

/**
 * 6.3 — Ordered list of users added to the grid.
 * Maintained as an immutable array (replace on mutation).
 *
 * Ported from: CalDavView.java `selectedUsers` LinkedHashSet (line 113)
 */
export const selectedUsers = signal<CalDavUser[]>([]);

/**
 * 6.4 — Events for each user in the current week, keyed by user.href.
 * Maintained as an immutable Map (replace on mutation).
 *
 * Ported from: CalDavView.java `userEvents` LinkedHashMap (line 119)
 */
export const userEvents = signal<Map<string, CalDavEvent[]>>(new Map());

/**
 * 6.5 — User hrefs for users whose event fetch failed.
 * Maintained as an immutable Set (replace on mutation).
 *
 * Ported from: CalDavView.java `failedUsers` LinkedHashSet (line 122)
 */
export const failedUsers = signal<Set<string>>(new Set());

/**
 * 6.6 — The Monday of the currently displayed week as ISO date string.
 *
 * Ported from: CalDavView.java `currentWeekStart` (line 116)
 */
export const currentWeekStart = signal<string>(getMondayOfWeek());

/**
 * 6.7 — Whether a loading operation is in progress (for spinner display).
 */
export const loading = signal<boolean>(false);

/**
 * 6.8 — Controls login dialog visibility. Starts hidden until
 * credential check completes (see `initializeApp()`).
 */
export const showLoginDialog = signal<boolean>(false);

/**
 * 6.8b — Whether the app is still checking for saved credentials.
 * While true, the login dialog is suppressed to avoid a visible flash.
 */
export const initializing = signal<boolean>(true);

/**
 * 6.9 — Whether to accept invalid TLS certificates (e.g. self-signed or
 * incomplete certificate chains). Off by default for security; can be
 * toggled in the login dialog. Only affects Tauri mode.
 */
export const acceptInvalidCerts = signal<boolean>(false);

/**
 * 6.10 — Favorited users for the currently connected server.
 * Loaded from localStorage on connect, cleared (but not deleted) on disconnect.
 * Each server URL has its own independent favorites list.
 */
export const favorites = signal<CalDavUser[]>([]);

// Keep the HTTP layer in sync with the signal value
effect(() => {
  setAcceptInvalidCerts(acceptInvalidCerts.value);
});

// ─── Computed Values ─────────────────────────────────────────────────────────

/**
 * Computed schedule rows: re-computed whenever selectedUsers, userEvents,
 * failedUsers, or currentWeekStart change.
 *
 * Ported from: CalDavView.java buildScheduleRows() + rebuildScheduleGrid()
 */
export const scheduleRows = computed<ScheduleRow[]>(() => {
  const users = selectedUsers.value;
  if (users.length === 0) {
    return [];
  }
  return buildScheduleRows(
    users,
    userEvents.value,
    failedUsers.value,
    currentWeekStart.value
  );
});

// ─── Action Functions ────────────────────────────────────────────────────────

/**
 * Attempts to connect to the CalDAV server with the given credentials.
 * Tests the connection by doing a search for "a" (same approach as Java).
 *
 * Ported from: CalDavView.java openLoginDialog() connect button handler (lines 752-788)
 *
 * @returns an error message string if connection failed, or null on success
 */
export async function connect(
  url: string,
  username: string,
  password: string
): Promise<string | null> {
  loading.value = true;
  try {
    // Test connection with a dummy search (same as Java line 767)
    await searchUsersOnServer(url, username, password, "a");

    connection.value = { url, username, password };
    connected.value = true;
    showLoginDialog.value = false;

    // Load favorites for this server
    favorites.value = loadFavorites(url);

    return null; // success
  } catch (e) {
    const message =
      e instanceof CalDavError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Unbekannter Fehler";
    return message;
  } finally {
    loading.value = false;
  }
}

/**
 * Adds a user to the schedule and fetches their events for the current week.
 *
 * Ported from: CalDavView.java addSelectedUser() lines 276-281
 *              CalDavView.java fetchEventsForUser() lines 324-341
 */
export async function addUser(user: CalDavUser): Promise<void> {
  // Check if already selected (by href)
  if (selectedUsers.value.some((u) => u.href === user.href)) {
    return;
  }

  // Add user immediately (optimistic update)
  selectedUsers.value = [...selectedUsers.value, user];

  // Fetch events
  await fetchEventsForSingleUser(user);
}

/**
 * Removes a user from the schedule grid.
 *
 * Ported from: CalDavView.java removeSelectedUser() lines 283-289
 */
export function removeUser(user: CalDavUser): void {
  selectedUsers.value = selectedUsers.value.filter(
    (u) => u.href !== user.href
  );

  // Remove from userEvents
  const newEvents = new Map(userEvents.value);
  newEvents.delete(user.href);
  userEvents.value = newEvents;

  // Remove from failedUsers
  const newFailed = new Set(failedUsers.value);
  newFailed.delete(user.href);
  failedUsers.value = newFailed;
}

/**
 * Toggles the favorite status of a user for the currently connected server.
 * If the user is already a favorite, they are removed; otherwise, they are added.
 * Changes are persisted to localStorage immediately.
 */
export function toggleFavorite(user: CalDavUser): void {
  if (!connection.value) return;

  const serverUrl = connection.value.url;
  const isFav = favorites.value.some((u) => u.href === user.href);

  if (isFav) {
    favorites.value = favorites.value.filter((u) => u.href !== user.href);
  } else {
    favorites.value = [...favorites.value, user];
  }

  saveFavorites(serverUrl, favorites.value);
}

/**
 * Navigates the schedule by the given number of weeks (positive = forward,
 * negative = backward).
 *
 * Ported from: CalDavView.java navigateWeek() lines 295-299
 */
export async function navigateWeek(offset: number): Promise<void> {
  const current = new Date(currentWeekStart.value + "T00:00:00Z");
  current.setUTCDate(current.getUTCDate() + offset * 7);
  currentWeekStart.value =
    current.getUTCFullYear().toString() +
    "-" +
    String(current.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(current.getUTCDate()).padStart(2, "0");

  await refreshAllEvents();
}

/**
 * Navigates to the current week (the week containing today).
 *
 * Ported from: CalDavView.java navigateToToday() lines 301-305
 */
export async function navigateToToday(): Promise<void> {
  currentWeekStart.value = getMondayOfWeek();
  await refreshAllEvents();
}

/**
 * Refreshes events for all selected users (clears cache and re-fetches).
 *
 * Ported from: CalDavView.java refreshAllEvents() lines 344-351
 */
export async function refreshAllEvents(): Promise<void> {
  userEvents.value = new Map();
  failedUsers.value = new Set();

  // Fetch all users in parallel
  const promises = selectedUsers.value.map((user) =>
    fetchEventsForSingleUser(user)
  );
  await Promise.all(promises);
}

/**
 * Disconnects from the server and resets all state.
 * Also clears any persisted credentials so the user must log in again.
 *
 * Ported from: CalDavView.java disconnect() lines 813-825
 */
export function disconnect(): void {
  connected.value = false;
  connection.value = null;
  selectedUsers.value = [];
  userEvents.value = new Map();
  failedUsers.value = new Set();
  favorites.value = [];
  showLoginDialog.value = true;

  // Clear persisted credentials (fire-and-forget)
  clearCredentials();
}

/**
 * Searches for users on the CalDAV server, filtering out already-selected users.
 *
 * Ported from: CalDavView.java searchUsersOnServer() lines 257-270
 *
 * @returns matching users (excluding already selected), or empty array on error
 */
export async function searchUsers(
  searchTerm: string
): Promise<CalDavUser[]> {
  if (!connected.value || connection.value === null) {
    return [];
  }

  try {
    const results = await searchUsersOnServer(
      connection.value.url,
      connection.value.username,
      connection.value.password,
      searchTerm
    );

    // Filter out already-selected users
    const selectedHrefs = new Set(
      selectedUsers.value.map((u) => u.href)
    );
    return results.filter((user) => !selectedHrefs.has(user.href));
  } catch {
    return [];
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Fetches events for a single user and updates the userEvents/failedUsers
 * signals. Does NOT modify selectedUsers.
 *
 * Ported from: CalDavView.java fetchEventsForUser() lines 324-341
 *
 * @returns an error message if the fetch failed, or null on success
 */
async function fetchEventsForSingleUser(
  user: CalDavUser
): Promise<string | null> {
  if (connection.value === null) {
    return "Nicht verbunden";
  }

  try {
    const events = await fetchWeekEvents(
      connection.value.url,
      user.href,
      connection.value.username,
      connection.value.password,
      currentWeekStart.value
    );

    // Update userEvents (immutable map replacement)
    const newEvents = new Map(userEvents.value);
    newEvents.set(user.href, events);
    userEvents.value = newEvents;

    // Remove from failed if previously failed
    if (failedUsers.value.has(user.href)) {
      const newFailed = new Set(failedUsers.value);
      newFailed.delete(user.href);
      failedUsers.value = newFailed;
    }

    return null;
  } catch (e) {
    // Store empty events but mark as failed
    const newEvents = new Map(userEvents.value);
    newEvents.set(user.href, []);
    userEvents.value = newEvents;

    const newFailed = new Set(failedUsers.value);
    newFailed.add(user.href);
    failedUsers.value = newFailed;

    const message =
      e instanceof CalDavError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Unbekannter Fehler";
    return message;
  }
}

// ─── App Initialization ──────────────────────────────────────────────────────

/**
 * Checks for saved credentials and attempts auto-login.
 * Must be called once at app startup (from the root component).
 *
 * - If saved credentials are found, attempts to connect silently.
 * - If auto-connect succeeds, the dialog is never shown.
 * - If auto-connect fails, clears the invalid credentials and shows the dialog.
 * - If no saved credentials exist, shows the dialog immediately.
 *
 * @returns result of the auto-login attempt for notification purposes:
 *   - `{ status: "success" }` if auto-login succeeded
 *   - `{ status: "failed", message: string }` if auto-login failed
 *   - `{ status: "none" }` if no saved credentials existed
 */
export async function initializeApp(): Promise<
  | { status: "success" }
  | { status: "failed"; message: string }
  | { status: "none" }
> {
  try {
    const saved = await loadCredentials();

    if (!saved) {
      showLoginDialog.value = true;
      return { status: "none" };
    }

    // Attempt auto-connect with saved credentials
    // Restore the acceptInvalidCerts flag BEFORE connecting, so the HTTP
    // layer uses the correct TLS setting for the first request.
    acceptInvalidCerts.value = saved.acceptInvalidCerts ?? false;
    const error = await connect(saved.url, saved.username, saved.password);

    if (error) {
      // Credentials are stale — clear them and show dialog
      await clearCredentials();
      showLoginDialog.value = true;
      return { status: "failed", message: error };
    }

    return { status: "success" };
  } catch {
    showLoginDialog.value = true;
    return { status: "none" };
  } finally {
    initializing.value = false;
  }
}
