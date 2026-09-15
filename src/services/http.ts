/**
 * HTTP abstraction layer that works in both dev (Vite proxy + fetch)
 * and production (Tauri HTTP plugin) environments.
 *
 * Ported from: CalDavClient.java HTTP request methods
 */

// Timeout constants (matching Java's CONNECT_TIMEOUT and REQUEST_TIMEOUT)
const REQUEST_TIMEOUT_MS = 30_000;

import type { AuthCredential } from "../model/types.js";

/**
 * Whether to accept invalid TLS certificates (e.g. self-signed or
 * incomplete chains). Only takes effect in Tauri mode; the Vite dev
 * proxy already sets `secure: false`.
 */
let _acceptInvalidCerts = false;

/** Enable or disable acceptance of invalid TLS certificates. */
export function setAcceptInvalidCerts(value: boolean): void {
  console.log("[http] setAcceptInvalidCerts: %s -> %s", _acceptInvalidCerts, value);
  _acceptInvalidCerts = value;
}

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
export function isTauri(): boolean {
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
 *   "https://isb-kalender.zit.mwn.de/caldav.php/user/" -> "/api/caldav/caldav.php/user/"
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
 * Wraps a promise with a timeout. Rejects with a descriptive error if
 * the promise does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Zeitüberschreitung: Der Server hat nicht rechtzeitig geantwortet.")),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Translates low-level network errors into user-friendly German messages.
 */
function humanizeNetworkError(e: unknown): Error {
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    if (e.name === "AbortError" || msg.includes("aborted") || msg.includes("timeout")) {
      return new Error("Zeitüberschreitung: Der Server hat nicht rechtzeitig geantwortet.");
    }
    if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network")
        || msg.includes("dns") || msg.includes("econnrefused") || msg.includes("enotfound")) {
      return new Error("Server nicht erreichbar. Bitte URL und Netzwerkverbindung überprüfen.");
    }
    if (msg.includes("ssl") || msg.includes("tls") || msg.includes("certificate")) {
      return new Error("TLS/SSL-Fehler. Aktivieren Sie ggf. die Option \"Ungültige TLS-Zertifikate akzeptieren\".");
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Sends an HTTP request, automatically choosing the right transport:
 * - In Tauri: uses @tauri-apps/plugin-http fetch (bypasses CORS)
 * - In browser/dev: uses native fetch() via Vite dev proxy
 */
export async function httpRequest(
  options: HttpRequestOptions
): Promise<HttpResponse> {
  console.log("[http] httpRequest: %s %s (backend=%s, acceptInvalidCerts=%s)",
    options.method, options.url, isTauri() ? "tauri" : "browser", _acceptInvalidCerts);
  try {
    const response = isTauri()
      ? await tauriFetch(options)
      : await browserFetch(options);
    console.log("[http] httpRequest: %s %s -> status %d",
      options.method, options.url, response.status);
    return response;
  } catch (e) {
    console.error("[http] httpRequest: %s %s -> FAILED:", options.method, options.url, e);
    throw humanizeNetworkError(e);
  }
}

/**
 * Tauri path: uses the Tauri HTTP plugin's fetch function.
 * Requests go directly to the CalDAV server URL (no CORS restriction
 * because the request is made from the Rust side).
 */
async function tauriFetch(options: HttpRequestOptions): Promise<HttpResponse> {
  const { fetch: tauriFetchFn } = await import("@tauri-apps/plugin-http");

  const response = await withTimeout(
    tauriFetchFn(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      connectTimeout: REQUEST_TIMEOUT_MS,
      ...(_acceptInvalidCerts
        ? { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }
        : {}),
    }),
    REQUEST_TIMEOUT_MS
  );

  const body = await withTimeout(response.text(), REQUEST_TIMEOUT_MS);

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

/**
 * Whether the app is running as a Tauri app on Windows. Kerberos/Negotiate
 * (Windows Integrated Authentication) is only available in that combination,
 * since it relies on native SSPI calls made from the Rust side.
 */
export function isWindowsTauri(): boolean {
  return (
    isTauri() &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Windows")
  );
}

/**
 * Result of one leg of the SPNEGO/Negotiate handshake, returned by the
 * `spnego_start` / `spnego_continue` Tauri commands.
 */
interface SpnegoStepResult {
  contextId: number;
  tokenB64: string;
  done: boolean;
}

/**
 * Extracts the base64 token from a "WWW-Authenticate: Negotiate <token>"
 * header value. Returns null if the header is absent, doesn't advertise
 * Negotiate, or carries no continuation token (bare "Negotiate").
 */
function extractNegotiateToken(wwwAuthenticate: string | undefined): string | null {
  if (!wwwAuthenticate) return null;
  const match = wwwAuthenticate.match(/Negotiate\s+([A-Za-z0-9+/=]+)/i);
  return match ? match[1] : null;
}

/** Whether a WWW-Authenticate header advertises the Negotiate scheme at all. */
function offersNegotiate(wwwAuthenticate: string | undefined): boolean {
  return !!wwwAuthenticate && /(^|,\s*)negotiate/i.test(wwwAuthenticate);
}

/**
 * Sends a request using Kerberos/SPNEGO (Windows Integrated Authentication).
 *
 * Flow (RFC 4559): send the request unauthenticated; on a 401 response that
 * advertises "Negotiate", ask the Rust side (native Windows SSPI, using the
 * current user's existing Kerberos ticket) for a token, and retry with an
 * "Authorization: Negotiate <token>" header. If the server replies with
 * another 401 carrying a continuation token, feed it back for a further
 * handshake leg (bounded, since NTLM-style multi-leg exchanges are finite).
 */
async function negotiateRequest(
  options: HttpRequestOptions,
  targetSpn: string
): Promise<HttpResponse> {
  let response = await httpRequest(options);
  if (response.status !== 401) {
    return response;
  }
  if (!offersNegotiate(response.headers["www-authenticate"])) {
    return response;
  }

  const { invoke } = await import("@tauri-apps/api/core");

  let step: SpnegoStepResult = await invoke("spnego_start", { targetSpn });
  try {
    const MAX_LEGS = 4;
    for (let leg = 0; leg < MAX_LEGS; leg++) {
      response = await httpRequest({
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Negotiate ${step.tokenB64}`,
        },
      });

      if (response.status !== 401 || step.done) {
        break;
      }

      const serverTokenB64 = extractNegotiateToken(response.headers["www-authenticate"]);
      if (!serverTokenB64) {
        break;
      }

      step = await invoke("spnego_continue", {
        contextId: step.contextId,
        targetSpn,
        serverTokenB64,
      });
    }
  } finally {
    await invoke("spnego_cleanup", { contextId: step.contextId }).catch(() => {});
  }

  return response;
}

/**
 * Sends an authenticated CalDAV request, dispatching to Basic Auth or
 * Kerberos/SPNEGO depending on the credential kind.
 */
export async function authenticatedRequest(
  options: HttpRequestOptions,
  credential: AuthCredential
): Promise<HttpResponse> {
  if (credential.kind === "basic") {
    return httpRequest({
      ...options,
      headers: {
        ...options.headers,
        Authorization: buildBasicAuthHeader(credential.username, credential.password),
      },
    });
  }

  if (!isWindowsTauri()) {
    throw new Error(
      "Kerberos-Anmeldung ist nur in der Windows-Desktop-App verfügbar."
    );
  }

  const targetSpn = "HTTP/" + new URL(options.url).hostname;
  return negotiateRequest(options, targetSpn);
}
