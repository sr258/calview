/**
 * CalDAV protocol client — ported from CalDavClient.java (880 lines)
 * and CalDavService.java (129 lines).
 *
 * Handles:
 * - XML request building (principal search, calendar query, free-busy query)
 * - HTTP REPORT requests via the http.ts abstraction layer
 * - XML response parsing using browser's built-in DOMParser
 * - Service-layer validation and event sorting
 *
 * The service layer (CalDavService.java) is folded into this module
 * rather than being a separate class, since it was thin validation + delegation.
 */

import type { CalDavUser, CalDavEvent } from "../model/types.js";
import { CalDavError } from "../model/types.js";
import { httpRequest, buildBasicAuthHeader } from "./http.js";
import {
  parseICalendarData,
  parseFreeBusyResponse,
  formatICalDate,
} from "./ical-parser.js";

// ─── XML Namespace constants ─────────────────────────────────────────────────
// Ported from CalDavClient.java lines 53-54
// Used with DOMParser's namespace-aware methods.

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

// ─── XML Request Templates ──────────────────────────────────────────────────

/**
 * XML body for a REPORT request that discovers all principals on the server.
 * Uses an empty match element to match all display names (wildcard).
 *
 * Ported from: CalDavClient.java PRINCIPAL_SEARCH_XML lines 73-87
 */
const PRINCIPAL_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:principal-property-search xmlns:d="DAV:" test="anyof">
  <d:property-search>
    <d:prop>
      <d:displayname/>
    </d:prop>
    <d:match/>
  </d:property-search>
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:principal-property-search>`;

/**
 * XML template for a REPORT request that searches principals by display name.
 * The placeholder {{SEARCH_TERM}} is replaced with the XML-escaped search term.
 *
 * Ported from: CalDavClient.java PRINCIPAL_SEARCH_BY_NAME_XML_TEMPLATE lines 95-109
 */
const PRINCIPAL_SEARCH_BY_NAME_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<d:principal-property-search xmlns:d="DAV:" test="anyof">
  <d:property-search>
    <d:prop>
      <d:displayname/>
    </d:prop>
    <d:match>{{SEARCH_TERM}}</d:match>
  </d:property-search>
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:principal-property-search>`;

/**
 * XML template for a REPORT calendar-query that fetches VEVENT data
 * within a time range. Uses <c:expand> (RFC 4791 Section 9.6.5) to instruct
 * the server to expand recurring events into individual instances.
 *
 * Ported from: CalDavClient.java CALENDAR_QUERY_XML_TEMPLATE lines 271-289
 */
const CALENDAR_QUERY_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:"
                  xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data>
      <c:expand start="{{START}}" end="{{END}}"/>
    </c:calendar-data>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="{{START}}" end="{{END}}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

/**
 * XML template for a REPORT free-busy-query (RFC 4791 section 7.10).
 * Used when the user only has CALDAV:read-free-busy privilege.
 *
 * Ported from: CalDavClient.java FREE_BUSY_QUERY_XML_TEMPLATE lines 297-302
 */
const FREE_BUSY_QUERY_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<c:free-busy-query xmlns:c="urn:ietf:params:xml:ns:caldav">
  <c:time-range start="{{START}}" end="{{END}}"/>
</c:free-busy-query>`;

// ─── XML Building Functions ──────────────────────────────────────────────────

/**
 * Builds the XML body for a principal-property-search REPORT with the given
 * search term. The search term is XML-escaped to prevent injection.
 *
 * Ported from: CalDavClient.java buildPrincipalSearchXml() lines 179-182
 */
export function buildPrincipalSearchXml(searchTerm: string): string {
  return PRINCIPAL_SEARCH_BY_NAME_XML_TEMPLATE.replace(
    "{{SEARCH_TERM}}",
    escapeXml(searchTerm)
  );
}

/**
 * Escapes XML special characters in a string to prevent injection
 * when embedding user input in XML request bodies.
 *
 * Ported from: CalDavClient.java escapeXml() lines 188-195
 */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Normalizes a URL by ensuring it has a trailing slash and a scheme prefix.
 *
 * Ported from: CalDavClient.java normalizeUrl() lines 840-849
 */
export function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.endsWith("/")) {
    normalized += "/";
  }
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  return normalized;
}

/**
 * Resolves an href (which may be relative) against the base URL
 * to produce an absolute URL.
 *
 * Ported from: CalDavClient.java resolveHref() lines 830-838
 */
export function resolveHref(baseUrl: string, href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return normalizeUrl(href);
  }
  // href is a path like /caldav.php/username/ — combine with base URL's scheme+host
  const resolved = new URL(href, baseUrl).toString();
  return normalizeUrl(resolved);
}

// ─── XML Response Parsing (using DOMParser) ──────────────────────────────────
// Uses the browser's built-in DOMParser for namespace-aware XML parsing,
// matching the Java DocumentBuilderFactory approach exactly.

/**
 * Internal representation of a principal during parsing.
 */
interface Principal {
  displayName: string;
  href: string;
}

/**
 * Parses a principal-property-search response into a list of principals.
 *
 * Ported from: CalDavClient.java parsePrincipalSearchResponse() lines 695-731
 */
export function parsePrincipalSearchResponse(xml: string): CalDavUser[] {
  const users: CalDavUser[] = [];
  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(xml, "application/xml");

    // Check for parse error
    const parseError = document.querySelector("parsererror");
    if (parseError) {
      throw new Error("XML parse error: " + parseError.textContent);
    }

    const responses = document.getElementsByTagNameNS(DAV_NS, "response");
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i] as Element;
      const href = getTextContent(response, DAV_NS, "href");
      if (href === null) {
        continue;
      }

      if (!isSuccessResponse(response)) {
        continue;
      }

      // Only include actual principals (have <principal/> in resourcetype)
      if (!isPrincipalResource(response)) {
        continue;
      }

      let displayName = getPropertyText(response, DAV_NS, "displayname");
      if (displayName === null || displayName.trim() === "") {
        displayName = href;
      }

      users.push({ displayName, href });
    }
  } catch (e) {
    if (e instanceof CalDavError) {
      throw e;
    }
    throw new CalDavError(
      "Failed to parse principal search response: " +
        (e instanceof Error ? e.message : String(e)),
      e
    );
  }
  return users;
}

/**
 * Parses a calendar-query REPORT response (multistatus with calendar-data)
 * into a list of CalDavEvent records.
 *
 * Ported from: CalDavClient.java parseCalendarQueryResponse() lines 389-418
 */
export function parseCalendarQueryResponse(
  xml: string,
  accessible: boolean
): CalDavEvent[] {
  const events: CalDavEvent[] = [];
  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(xml, "application/xml");

    const parseError = document.querySelector("parsererror");
    if (parseError) {
      throw new Error("XML parse error: " + parseError.textContent);
    }

    const responses = document.getElementsByTagNameNS(DAV_NS, "response");
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i] as Element;

      if (!isSuccessResponse(response)) {
        continue;
      }

      const calendarData = getPropertyText(
        response,
        CALDAV_NS,
        "calendar-data"
      );
      if (calendarData === null || calendarData.trim() === "") {
        continue;
      }

      events.push(...parseICalendarData(calendarData, accessible));
    }
  } catch (e) {
    if (e instanceof CalDavError) {
      throw e;
    }
    throw new CalDavError(
      "Failed to parse calendar query response: " +
        (e instanceof Error ? e.message : String(e)),
      e
    );
  }
  return events;
}

// ─── XML Helper Functions ────────────────────────────────────────────────────

/**
 * Checks if a response element contains a propstat with a 200 status.
 *
 * Ported from: CalDavClient.java isSuccessResponse() lines 789-798
 */
function isSuccessResponse(response: Element): boolean {
  const propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
  for (let i = 0; i < propstats.length; i++) {
    const propstat = propstats[i] as Element;
    const statusText = getTextContent(propstat, DAV_NS, "status");
    if (statusText !== null && statusText.includes("200")) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a response element's resourcetype contains a <principal/> element.
 *
 * Ported from: CalDavClient.java isPrincipalResource() lines 733-751
 */
function isPrincipalResource(response: Element): boolean {
  const propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
  for (let i = 0; i < propstats.length; i++) {
    const propstat = propstats[i] as Element;
    const props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
    for (let j = 0; j < props.length; j++) {
      const prop = props[j] as Element;
      const resourceTypes = prop.getElementsByTagNameNS(DAV_NS, "resourcetype");
      for (let k = 0; k < resourceTypes.length; k++) {
        const resourceType = resourceTypes[k] as Element;
        const principalElements = resourceType.getElementsByTagNameNS(
          DAV_NS,
          "principal"
        );
        if (principalElements.length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Gets the text content of a specific property within a response's propstat/prop.
 *
 * Ported from: CalDavClient.java getPropertyText() lines 801-816
 */
function getPropertyText(
  response: Element,
  namespace: string,
  localName: string
): string | null {
  const propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
  for (let i = 0; i < propstats.length; i++) {
    const propstat = propstats[i] as Element;
    const props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
    for (let j = 0; j < props.length; j++) {
      const prop = props[j] as Element;
      const elements = prop.getElementsByTagNameNS(namespace, localName);
      if (elements.length > 0) {
        const text = elements[0].textContent;
        return text !== null && text.trim() !== "" ? text.trim() : null;
      }
    }
  }
  return null;
}

/**
 * Gets the text content of the first matching element within a parent.
 *
 * Ported from: CalDavClient.java getTextContent() lines 818-824
 */
function getTextContent(
  parent: Element,
  namespace: string,
  localName: string
): string | null {
  const elements = parent.getElementsByTagNameNS(namespace, localName);
  if (elements.length > 0) {
    return elements[0].textContent;
  }
  return null;
}

// ─── HTTP Request Functions ──────────────────────────────────────────────────

/**
 * Sends a REPORT request to the server root for principal-property-search.
 * Uses Depth: 0.
 *
 * Ported from: CalDavClient.java sendReport() lines 753-787
 */
async function sendReport(
  normalizedUrl: string,
  username: string,
  password: string,
  reportXml: string
): Promise<string> {
  const response = await httpRequest({
    url: normalizedUrl,
    method: "REPORT",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "0",
      Authorization: buildBasicAuthHeader(username, password),
    },
    body: reportXml,
  });

  switch (response.status) {
    case 207:
      return response.body;
    case 401:
      throw new CalDavError(
        "Authentication failed. Please check your username and password."
      );
    case 403:
      throw new CalDavError(
        "Access denied. You don't have permission to search principals."
      );
    case 404:
      throw new CalDavError("URL not found. Please check the URL.");
    default:
      throw new CalDavError(
        `Server returned unexpected status ${response.status}.`
      );
  }
}

/**
 * Sends a REPORT request with a calendar-query body.
 * Uses Depth: 1. Expects 207 multistatus response.
 *
 * Ported from: CalDavClient.java sendCalendarReport() lines 304-338
 */
async function sendCalendarReport(
  normalizedUrl: string,
  username: string,
  password: string,
  reportXml: string
): Promise<string> {
  const response = await httpRequest({
    url: normalizedUrl,
    method: "REPORT",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
      Authorization: buildBasicAuthHeader(username, password),
    },
    body: reportXml,
  });

  switch (response.status) {
    case 207:
      return response.body;
    case 401:
      throw new CalDavError(
        "Authentication failed. Please check your username and password."
      );
    case 403:
      throw new CalDavError(
        "Access denied. You don't have permission to access this calendar."
      );
    case 404:
      throw new CalDavError("Calendar not found at this URL.");
    default:
      throw new CalDavError(
        `Server returned unexpected status ${response.status}.`
      );
  }
}

/**
 * Sends a REPORT request with a free-busy-query body.
 * Uses Depth: 1. Expects 200 OK with text/calendar body (NOT 207 multistatus).
 *
 * Ported from: CalDavClient.java sendFreeBusyReport() lines 347-383
 */
async function sendFreeBusyReport(
  normalizedUrl: string,
  username: string,
  password: string,
  reportXml: string
): Promise<string> {
  const response = await httpRequest({
    url: normalizedUrl,
    method: "REPORT",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
      Authorization: buildBasicAuthHeader(username, password),
    },
    body: reportXml,
  });

  switch (response.status) {
    case 200:
      return response.body;
    case 401:
      throw new CalDavError(
        "Authentication failed. Please check your username and password."
      );
    case 403:
      throw new CalDavError(
        "Access denied. You don't have permission to view free/busy data for this calendar."
      );
    case 404:
      throw new CalDavError("Calendar not found at this URL.");
    default:
      throw new CalDavError(
        `Server returned unexpected status ${response.status}.`
      );
  }
}

// ─── Service-Layer Functions ─────────────────────────────────────────────────
// Ported from CalDavService.java — validation, delegation, and sorting
// merged directly into this module.

/**
 * Validates that required connection inputs are non-empty.
 *
 * Ported from: CalDavService.java validateInputs() lines 118-128
 */
function validateInputs(url: string, username: string, password: string): void {
  if (!url || url.trim() === "") {
    throw new CalDavError("CalDAV URL must not be empty.");
  }
  if (!username || username.trim() === "") {
    throw new CalDavError("Username must not be empty.");
  }
  if (!password || password.trim() === "") {
    throw new CalDavError("Password must not be empty.");
  }
}

/**
 * Discovers all users (principals) on the CalDAV server.
 * Uses the principal-property-search REPORT method.
 *
 * Ported from: CalDavService.java discoverUsers() lines 36-44
 *              CalDavClient.java discoverUsers() lines 121-136
 */
export async function discoverUsers(
  url: string,
  username: string,
  password: string
): Promise<CalDavUser[]> {
  validateInputs(url, username, password);

  try {
    const normalizedUrl = normalizeUrl(url);
    const responseBody = await sendReport(
      normalizedUrl,
      username,
      password,
      PRINCIPAL_SEARCH_XML
    );
    return parsePrincipalSearchResponse(responseBody);
  } catch (e) {
    if (e instanceof CalDavError) {
      throw e;
    }
    throw new CalDavError(
      "Failed to discover users: " +
        (e instanceof Error ? e.message : String(e)),
      e
    );
  }
}

/**
 * Searches for users (principals) whose display name matches the search term.
 * The search is performed server-side using the principal-property-search REPORT.
 *
 * Ported from: CalDavService.java searchUsers() lines 61-72
 *              CalDavClient.java searchUsers() lines 153-170
 */
export async function searchUsers(
  url: string,
  username: string,
  password: string,
  searchTerm: string
): Promise<CalDavUser[]> {
  validateInputs(url, username, password);
  if (!searchTerm || searchTerm.trim() === "") {
    throw new CalDavError("Search term must not be empty.");
  }

  try {
    const normalizedUrl = normalizeUrl(url);
    const searchXml = buildPrincipalSearchXml(searchTerm);
    const responseBody = await sendReport(
      normalizedUrl,
      username,
      password,
      searchXml
    );
    return parsePrincipalSearchResponse(responseBody);
  } catch (e) {
    if (e instanceof CalDavError) {
      throw e;
    }
    throw new CalDavError(
      "Failed to search users: " +
        (e instanceof Error ? e.message : String(e)),
      e
    );
  }
}

/**
 * Fetches events for the specified week from a user's default calendar.
 *
 * Uses a smart fallback strategy: first attempts a calendar-query for full
 * event details. If the server returns 403 (access denied), falls back to
 * a free-busy-query which returns only busy time slots.
 *
 * Results are sorted by date ascending, then by startTime ascending
 * (all-day events first).
 *
 * Ported from: CalDavService.java fetchWeekEvents() lines 89-116
 *              CalDavClient.java fetchWeekEvents() lines 218-256
 *
 * @param baseUrl   the base CalDAV URL used for the original connection
 * @param userHref  the href of the user's principal collection
 * @param username  the username for authentication
 * @param password  the password for authentication
 * @param weekStart the Monday of the week as ISO date string "YYYY-MM-DD"
 */
export async function fetchWeekEvents(
  baseUrl: string,
  userHref: string,
  username: string,
  password: string,
  weekStart: string
): Promise<CalDavEvent[]> {
  validateInputs(baseUrl, username, password);

  try {
    const normalizedBase = normalizeUrl(baseUrl);
    const calendarHref = userHref.endsWith("/")
      ? userHref + "calendar/"
      : userHref + "/calendar/";
    const calendarUrl = resolveHref(normalizedBase, calendarHref);

    // weekStart is "YYYY-MM-DD", weekEnd is 7 days later (exclusive)
    const weekStartDate = new Date(weekStart + "T00:00:00Z");
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
    const weekEnd =
      weekEndDate.getUTCFullYear().toString() +
      "-" +
      String(weekEndDate.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(weekEndDate.getUTCDate()).padStart(2, "0");

    const startStr = formatICalDate(weekStart) + "T000000Z";
    const endStr = formatICalDate(weekEnd) + "T000000Z";

    let events: CalDavEvent[];

    // Try calendar-query first for full event details
    try {
      const reportXml = CALENDAR_QUERY_XML_TEMPLATE.replace(
        /\{\{START\}\}/g,
        startStr
      ).replace(/\{\{END\}\}/g, endStr);
      const responseBody = await sendCalendarReport(
        calendarUrl,
        username,
        password,
        reportXml
      );
      events = parseCalendarQueryResponse(responseBody, true);
    } catch (e) {
      if (
        e instanceof CalDavError &&
        e.message.includes("Access denied")
      ) {
        // Fall back to free-busy-query for restricted calendars
        const reportXml = FREE_BUSY_QUERY_XML_TEMPLATE.replace(
          /\{\{START\}\}/g,
          startStr
        ).replace(/\{\{END\}\}/g, endStr);
        const responseBody = await sendFreeBusyReport(
          calendarUrl,
          username,
          password,
          reportXml
        );
        events = parseFreeBusyResponse(responseBody);
      } else {
        throw e;
      }
    }

    // Sort by date, then by time (all-day events first)
    // Ported from: CalDavService.java lines 97-112
    events.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      if (a.startTime === null && b.startTime === null) {
        return 0;
      }
      if (a.startTime === null) {
        return -1;
      }
      if (b.startTime === null) {
        return 1;
      }
      return a.startTime.localeCompare(b.startTime);
    });

    return events;
  } catch (e) {
    if (e instanceof CalDavError) {
      throw e;
    }
    throw new CalDavError(
      "Failed to fetch events: " +
        (e instanceof Error ? e.message : String(e)),
      e
    );
  }
}
