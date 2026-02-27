/**
 * HTTP abstraction layer that works in both dev (Vite proxy + fetch)
 * and production (Tauri HTTP plugin) environments.
 *
 * Ported from: CalDavClient.java HTTP request methods
 */

// Timeout constants (matching Java's CONNECT_TIMEOUT and REQUEST_TIMEOUT)
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Options for an HTTP request.
 */
export interface HttpRequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Response from an HTTP request.
 */
export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Detects whether we are running inside a Tauri webview.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The default CalDAV server URL.
 * Was in application.properties in the Java version.
 */
export const DEFAULT_CALDAV_URL =
  "https://isb-kalender.zit.mwn.de/caldav.php";

/**
 * The Vite dev proxy prefix used to forward CalDAV requests.
 * In dev mode, requests to this path are proxied to the real CalDAV server.
 */
const DEV_PROXY_PREFIX = "/api/caldav";

/**
 * Rewrites a CalDAV server URL to go through the Vite dev proxy.
 * In dev mode, we can't make direct requests to the CalDAV server
 * due to CORS restrictions, so we route through Vite's proxy.
 *
 * Example:
 *   "https://isb-kalender.zit.mwn.de/caldav.php/user/" -> "/api/caldav/user/"
 */
function rewriteUrlForProxy(url: string): string {
  try {
    const parsed = new URL(url);
    // Extract the path after the CalDAV base (e.g., /caldav.php/user/calendar/)
    // The proxy target is already configured to point to the server root
    const pathAfterBase = parsed.pathname;
    return DEV_PROXY_PREFIX + pathAfterBase;
  } catch {
    // If URL parsing fails, just prefix it
    return DEV_PROXY_PREFIX + "/" + url;
  }
}

/**
 * Sends an HTTP request, automatically choosing the right transport:
 * - In Tauri: uses @tauri-apps/plugin-http fetch (bypasses CORS)
 * - In browser/dev: uses native fetch() via Vite dev proxy
 */
export async function httpRequest(
  options: HttpRequestOptions
): Promise<HttpResponse> {
  if (isTauri()) {
    return tauriFetch(options);
  }
  return browserFetch(options);
}

/**
 * Tauri path: uses the Tauri HTTP plugin's fetch function.
 * Requests go directly to the CalDAV server URL (no CORS restriction
 * because the request is made from the Rust side).
 */
async function tauriFetch(options: HttpRequestOptions): Promise<HttpResponse> {
  const { fetch: tauriFetchFn } = await import("@tauri-apps/plugin-http");

  const response = await tauriFetchFn(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    connectTimeout: REQUEST_TIMEOUT_MS,
  });

  const body = await response.text();

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: response.status,
    body,
    headers,
  };
}

/**
 * Browser/dev path: uses native fetch() with the URL rewritten to
 * go through Vite's dev proxy. This avoids CORS issues during development.
 */
async function browserFetch(
  options: HttpRequestOptions
): Promise<HttpResponse> {
  const proxyUrl = rewriteUrlForProxy(options.url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(proxyUrl, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });

    const body = await response.text();

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      body,
      headers,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Builds a Basic Authentication header value.
 *
 * Ported from: CalDavClient.java sendReport()/sendCalendarReport()/sendFreeBusyReport()
 * where credentials are encoded as Base64(username:password).
 */
export function buildBasicAuthHeader(
  username: string,
  password: string
): string {
  return "Basic " + btoa(username + ":" + password);
}
