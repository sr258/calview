package de.bycsitsm.caldav;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.io.StringReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Low-level CalDAV protocol client that communicates with CalDAV servers
 * using Java's built-in {@link HttpClient}.
 * <p>
 * Supports discovering all principals (users) on the server via the
 * {@code principal-property-search} REPORT method (RFC 3744), and
 * fetching weekly events or free/busy data for individual users.
 * <p>
 * When fetching events, the client uses a smart fallback strategy:
 * it first attempts a {@code calendar-query} to get full event details,
 * and if access is denied (HTTP 403), falls back to a
 * {@code free-busy-query} to get busy time slots only.
 */
@Component
class CalDavClient {

    private static final Logger log = LoggerFactory.getLogger(CalDavClient.class);

    private static final String DAV_NS = "DAV:";
    private static final String CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

    private final boolean trustAllCertificates;

    CalDavClient(@Value("${caldav.trust-all-certificates:true}") boolean trustAllCertificates) {
        this.trustAllCertificates = trustAllCertificates;
        if (trustAllCertificates) {
            log.warn("CalDAV client is configured to accept all SSL certificates including self-signed. "
                    + "Set caldav.trust-all-certificates=false to enforce certificate validation.");
        }
    }

    /**
     * XML body for a REPORT request that discovers all principals on the server.
     * Uses an empty match element to match all display names (wildcard).
     */
    private static final String PRINCIPAL_SEARCH_XML = """
            <?xml version="1.0" encoding="UTF-8"?>
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
            </d:principal-property-search>
            """;

    /**
     * XML template for a REPORT request that searches principals by display name.
     * The placeholder {@code {{SEARCH_TERM}}} is replaced with the XML-escaped
     * search term. DAViCal performs a case-insensitive substring match on the
     * display name.
     */
    private static final String PRINCIPAL_SEARCH_BY_NAME_XML_TEMPLATE = """
            <?xml version="1.0" encoding="UTF-8"?>
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
            </d:principal-property-search>
            """;

    /**
     * Discovers all users (principals) on the CalDAV server using the
     * {@code principal-property-search} REPORT method.
     *
     * @param url      the CalDAV URL (typically the server root, e.g. {@code /caldav.php/})
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of all discovered users
     * @throws CalDavException if the request fails or the response cannot be parsed
     */
    List<CalDavUser> discoverUsers(String url, String username, String password) {
        try {
            var normalizedUrl = normalizeUrl(url);
            var principals = discoverPrincipals(normalizedUrl, username, password);

            var users = new ArrayList<CalDavUser>();
            for (var principal : principals) {
                users.add(new CalDavUser(principal.displayName(), principal.href()));
            }
            return users;
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to discover users: " + e.getMessage(), e);
        }
    }

    /**
     * Searches for users (principals) on the CalDAV server whose display name
     * matches the given search term. Uses the {@code principal-property-search}
     * REPORT method with the search term in the {@code <match>} element.
     * <p>
     * DAViCal performs a case-insensitive substring match on the display name
     * and limits results to 100 entries per REPORT response.
     *
     * @param url        the CalDAV URL (typically the server root)
     * @param username   the username for authentication
     * @param password   the password for authentication
     * @param searchTerm the search term to match against display names
     * @return a list of matching users
     * @throws CalDavException if the request fails or the response cannot be parsed
     */
    List<CalDavUser> searchUsers(String url, String username, String password, String searchTerm) {
        try {
            var normalizedUrl = normalizeUrl(url);
            var searchXml = buildPrincipalSearchXml(searchTerm);
            var responseBody = sendReport(normalizedUrl, username, password, searchXml);
            var principals = parsePrincipalSearchResponse(responseBody);

            var users = new ArrayList<CalDavUser>();
            for (var principal : principals) {
                users.add(new CalDavUser(principal.displayName(), principal.href()));
            }
            return users;
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to search users: " + e.getMessage(), e);
        }
    }

    /**
     * Builds the XML body for a principal-property-search REPORT with the given
     * search term. The search term is XML-escaped to prevent injection.
     *
     * @param searchTerm the search term to place in the {@code <match>} element
     * @return the complete XML request body
     */
    String buildPrincipalSearchXml(String searchTerm) {
        return PRINCIPAL_SEARCH_BY_NAME_XML_TEMPLATE
                .replace("{{SEARCH_TERM}}", escapeXml(searchTerm));
    }

    /**
     * Escapes XML special characters in a string to prevent injection
     * when embedding user input in XML request bodies.
     */
    private static String escapeXml(String input) {
        return input
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    /**
     * Fetches events for the specified week from the given user's default calendar.
     * <p>
     * Uses a smart fallback strategy: first attempts a CalDAV REPORT
     * {@code calendar-query} to retrieve full event details (summary, time,
     * status). If the server returns HTTP 403 (access denied), falls back to
     * a {@code free-busy-query} which returns only busy time slots without
     * event details.
     * <p>
     * The {@code userHref} is the principal's href as returned by
     * {@link #discoverUsers}. The default calendar collection path is
     * derived by appending {@code "calendar/"} to the user's href.
     *
     * @param baseUrl   the base CalDAV URL used for the original connection
     * @param userHref  the href of the user's principal collection
     * @param username  the username for authentication
     * @param password  the password for authentication
     * @param weekStart the Monday of the week to fetch events for
     * @return a list of events for the specified week
     * @throws CalDavException if the request fails or the response cannot be parsed
     */
    List<CalDavEvent> fetchWeekEvents(String baseUrl, String userHref, String username, String password,
                                      LocalDate weekStart) {
        try {
            var normalizedBase = normalizeUrl(baseUrl);
            var calendarHref = userHref.endsWith("/")
                    ? userHref + "calendar/"
                    : userHref + "/calendar/";
            var calendarUrl = resolveHref(normalizedBase, calendarHref);

            var weekEnd = weekStart.plusDays(7); // exclusive: Monday of next week

            var startStr = weekStart.format(ICAL_DATE_FORMATTER) + "T000000Z";
            var endStr = weekEnd.format(ICAL_DATE_FORMATTER) + "T000000Z";

            // Try calendar-query first for full event details
            try {
                var reportXml = CALENDAR_QUERY_XML_TEMPLATE
                        .replace("{{START}}", startStr)
                        .replace("{{END}}", endStr);
                var responseBody = sendCalendarReport(calendarUrl, username, password, reportXml);
                return parseCalendarQueryResponse(responseBody, true);
            } catch (CalDavException e) {
                if (e.getMessage() != null && e.getMessage().contains("Access denied")) {
                    // Fall back to free-busy-query for restricted calendars
                    log.debug("Calendar-query denied for {}, falling back to free-busy-query", calendarUrl);
                    var reportXml = FREE_BUSY_QUERY_XML_TEMPLATE
                            .replace("{{START}}", startStr)
                            .replace("{{END}}", endStr);
                    var responseBody = sendFreeBusyReport(calendarUrl, username, password, reportXml);
                    return parseFreeBusyResponse(responseBody);
                }
                throw e;
            }
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to fetch events: " + e.getMessage(), e);
        }
    }

    private static final DateTimeFormatter ICAL_DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyyMMdd");

    /**
     * XML template for a REPORT calendar-query that fetches VEVENT data
     * within a time range. The placeholders {@code {{START}}} and {@code {{END}}}
     * are replaced with iCalendar date-time strings.
     */
    private static final String CALENDAR_QUERY_XML_TEMPLATE = """
            <?xml version="1.0" encoding="UTF-8"?>
            <c:calendar-query xmlns:d="DAV:"
                              xmlns:c="urn:ietf:params:xml:ns:caldav">
              <d:prop>
                <d:getetag/>
                <c:calendar-data/>
              </d:prop>
              <c:filter>
                <c:comp-filter name="VCALENDAR">
                  <c:comp-filter name="VEVENT">
                    <c:time-range start="{{START}}" end="{{END}}"/>
                  </c:comp-filter>
                </c:comp-filter>
              </c:filter>
            </c:calendar-query>
            """;

    /**
     * XML template for a REPORT free-busy-query (RFC 4791 section 7.10).
     * Used when the user only has {@code CALDAV:read-free-busy} privilege
     * (but not {@code DAV:read}) on a calendar. Returns VFREEBUSY data
     * with busy periods instead of full event details.
     */
    private static final String FREE_BUSY_QUERY_XML_TEMPLATE = """
            <?xml version="1.0" encoding="UTF-8"?>
            <c:free-busy-query xmlns:c="urn:ietf:params:xml:ns:caldav">
              <c:time-range start="{{START}}" end="{{END}}"/>
            </c:free-busy-query>
            """;

    private String sendCalendarReport(String normalizedUrl, String username, String password, String reportXml)
            throws IOException, InterruptedException {
        var credentials = Base64.getEncoder().encodeToString(
                (username + ":" + password).getBytes(StandardCharsets.UTF_8));

        var clientBuilder = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NORMAL);

        if (trustAllCertificates) {
            clientBuilder.sslContext(createTrustAllSslContext());
        }

        var httpClient = clientBuilder.build();

        var request = HttpRequest.newBuilder()
                .uri(URI.create(normalizedUrl))
                .method("REPORT", HttpRequest.BodyPublishers.ofString(reportXml))
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "1")
                .header("Authorization", "Basic " + credentials)
                .timeout(REQUEST_TIMEOUT)
                .build();

        log.debug("Sending REPORT calendar-query to {}", normalizedUrl);
        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        return switch (response.statusCode()) {
            case 207 -> response.body();
            case 401 -> throw new CalDavException("Authentication failed. Please check your username and password.");
            case 403 -> throw new CalDavException("Access denied. You don't have permission to access this calendar.");
            case 404 -> throw new CalDavException("Calendar not found at this URL.");
            default -> throw new CalDavException("Server returned unexpected status " + response.statusCode() + ".");
        };
    }

    /**
     * Sends a REPORT request with a {@code free-busy-query} body.
     * <p>
     * Unlike {@code calendar-query}, the response is a direct {@code 200 OK}
     * with a {@code text/calendar} body containing a VCALENDAR with a
     * VFREEBUSY component — NOT a 207 multistatus XML response.
     */
    private String sendFreeBusyReport(String normalizedUrl, String username, String password, String reportXml)
            throws IOException, InterruptedException {
        var credentials = Base64.getEncoder().encodeToString(
                (username + ":" + password).getBytes(StandardCharsets.UTF_8));

        var clientBuilder = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NORMAL);

        if (trustAllCertificates) {
            clientBuilder.sslContext(createTrustAllSslContext());
        }

        var httpClient = clientBuilder.build();

        var request = HttpRequest.newBuilder()
                .uri(URI.create(normalizedUrl))
                .method("REPORT", HttpRequest.BodyPublishers.ofString(reportXml))
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "1")
                .header("Authorization", "Basic " + credentials)
                .timeout(REQUEST_TIMEOUT)
                .build();

        log.debug("Sending REPORT free-busy-query to {}", normalizedUrl);
        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        log.debug("Free-busy-query response status: {}, body length: {}", response.statusCode(), response.body().length());
        log.trace("Free-busy-query response body:\n{}", response.body());

        return switch (response.statusCode()) {
            case 200 -> response.body();
            case 401 -> throw new CalDavException("Authentication failed. Please check your username and password.");
            case 403 -> throw new CalDavException("Access denied. You don't have permission to view free/busy data for this calendar.");
            case 404 -> throw new CalDavException("Calendar not found at this URL.");
            default -> throw new CalDavException("Server returned unexpected status " + response.statusCode() + ".");
        };
    }

    /**
     * Parses a calendar-query REPORT response (multistatus with calendar-data)
     * into a list of {@link CalDavEvent} records.
     */
    List<CalDavEvent> parseCalendarQueryResponse(String xml, boolean accessible) {
        var events = new ArrayList<CalDavEvent>();
        try {
            var factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            var builder = factory.newDocumentBuilder();
            var document = builder.parse(new InputSource(new StringReader(xml)));

            var responses = document.getElementsByTagNameNS(DAV_NS, "response");
            for (int i = 0; i < responses.getLength(); i++) {
                var response = (Element) responses.item(i);

                if (!isSuccessResponse(response)) {
                    continue;
                }

                var calendarData = getPropertyText(response, CALDAV_NS, "calendar-data");
                if (calendarData == null || calendarData.isBlank()) {
                    continue;
                }

                events.addAll(parseICalendarData(calendarData, accessible));
            }
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to parse calendar query response: " + e.getMessage(), e);
        }
        return events;
    }

    // iCalendar property patterns
    private static final Pattern SUMMARY_PATTERN = Pattern.compile("(?m)^SUMMARY[;:](.*)$");
    private static final Pattern DTSTART_PATTERN = Pattern.compile("(?m)^DTSTART[;:](.*)$");
    private static final Pattern DTEND_PATTERN = Pattern.compile("(?m)^DTEND[;:](.*)$");
    private static final Pattern CLASS_PATTERN = Pattern.compile("(?m)^CLASS[;:](.*)$");
    private static final Pattern FREEBUSY_PATTERN = Pattern.compile("(?m)^FREEBUSY[;:](.*)$");

    /**
     * Parses raw iCalendar text data into {@link CalDavEvent} records.
     * Handles VEVENT blocks, extracts SUMMARY, DTSTART, DTEND, and CLASS properties.
     */
    List<CalDavEvent> parseICalendarData(String icalData, boolean accessible) {
        var events = new ArrayList<CalDavEvent>();

        // Unfold lines: iCal spec says lines can be folded with CRLF + whitespace
        var unfolded = icalData.replaceAll("\\r?\\n[ \\t]", "");

        // Split into VEVENT blocks
        var veventStart = 0;
        while ((veventStart = unfolded.indexOf("BEGIN:VEVENT", veventStart)) != -1) {
            var veventEnd = unfolded.indexOf("END:VEVENT", veventStart);
            if (veventEnd == -1) {
                break;
            }

            var veventBlock = unfolded.substring(veventStart, veventEnd);

            var summary = extractICalProperty(veventBlock, SUMMARY_PATTERN);
            var dtstart = extractICalProperty(veventBlock, DTSTART_PATTERN);
            var dtend = extractICalProperty(veventBlock, DTEND_PATTERN);
            var classValue = extractICalProperty(veventBlock, CLASS_PATTERN);

            if (dtstart == null) {
                veventStart = veventEnd + 1;
                continue;
            }

            var date = parseICalDate(dtstart);
            var startTime = parseICalTime(dtstart);
            var endTime = dtend != null ? parseICalTime(dtend) : null;
            var status = classValue != null ? classValue.strip() : "PUBLIC";

            if (date == null) {
                veventStart = veventEnd + 1;
                continue;
            }

            if (accessible) {
                events.add(new CalDavEvent(
                        summary != null ? summary.strip() : "(No title)",
                        date, startTime, endTime, status, true));
            } else {
                // For restricted calendars, hide the name
                events.add(new CalDavEvent(null, date, startTime, endTime, status, false));
            }

            veventStart = veventEnd + 1;
        }

        return events;
    }

    private @Nullable String extractICalProperty(String block, Pattern pattern) {
        var matcher = pattern.matcher(block);
        if (matcher.find()) {
            var value = matcher.group(1);
            // Handle property parameters like DTSTART;VALUE=DATE:20250210
            var colonIdx = value.indexOf(':');
            if (colonIdx >= 0 && value.contains("=")) {
                // Has parameters before the colon
                return value.substring(colonIdx + 1).strip();
            }
            return value.strip();
        }
        return null;
    }

    /**
     * Parses a free-busy-query REPORT response (raw iCalendar text with
     * VFREEBUSY component) into a list of {@link CalDavEvent} records.
     * <p>
     * The response body contains a VCALENDAR with a VFREEBUSY component.
     * FREEBUSY lines have the format:
     * <pre>
     * FREEBUSY;FBTYPE=BUSY:20250210T140000Z/20250210T150000Z
     * FREEBUSY:20250210T140000Z/20250210T150000Z,20250211T090000Z/20250211T100000Z
     * FREEBUSY;FBTYPE=BUSY-TENTATIVE:20250212T080000Z/PT1H
     * </pre>
     * Each period is {@code start/end} or {@code start/duration}. Multiple
     * periods can be comma-separated on a single line.
     *
     * @param icalBody the raw iCalendar response body
     * @return a list of events representing busy periods, all with {@code accessible=false}
     */
    List<CalDavEvent> parseFreeBusyResponse(String icalBody) {
        var events = new ArrayList<CalDavEvent>();

        // Unfold lines
        var unfolded = icalBody.replaceAll("\\r?\\n[ \\t]", "");

        // Find the VFREEBUSY block
        var fbStart = unfolded.indexOf("BEGIN:VFREEBUSY");
        var fbEnd = unfolded.indexOf("END:VFREEBUSY");
        if (fbStart == -1 || fbEnd == -1) {
            log.debug("No VFREEBUSY block found in free-busy response");
            return events;
        }

        var fbBlock = unfolded.substring(fbStart, fbEnd);

        // Find all FREEBUSY lines
        var matcher = FREEBUSY_PATTERN.matcher(fbBlock);
        while (matcher.find()) {
            var rawValue = matcher.group(1).strip();

            // Extract FBTYPE from parameters if present
            var fbType = "BUSY"; // default per RFC 4791
            var periodsStr = rawValue;

            // The regex captures everything after "FREEBUSY;" or "FREEBUSY:"
            // If the raw match group contains parameters (e.g. "FBTYPE=BUSY:periods"),
            // we need to split on the last colon that separates params from value.
            var colonIdx = rawValue.indexOf(':');
            if (colonIdx >= 0 && rawValue.contains("=")) {
                // Has parameters before the colon
                var params = rawValue.substring(0, colonIdx);
                periodsStr = rawValue.substring(colonIdx + 1).strip();

                // Extract FBTYPE
                var fbTypeMatch = Pattern.compile("FBTYPE=([A-Z-]+)").matcher(params);
                if (fbTypeMatch.find()) {
                    fbType = fbTypeMatch.group(1);
                }
            }

            // Parse comma-separated periods
            var periods = periodsStr.split(",");
            for (var period : periods) {
                var trimmed = period.strip();
                if (trimmed.isEmpty()) {
                    continue;
                }

                var slashIdx = trimmed.indexOf('/');
                if (slashIdx == -1) {
                    log.warn("Invalid FREEBUSY period (no slash): {}", trimmed);
                    continue;
                }

                var startStr = trimmed.substring(0, slashIdx);
                var endOrDuration = trimmed.substring(slashIdx + 1);

                var date = parseICalDate(startStr);
                var startTime = parseICalTime(startStr);

                if (date == null) {
                    log.warn("Could not parse date from FREEBUSY period: {}", startStr);
                    continue;
                }

                LocalTime endTime;
                if (endOrDuration.startsWith("P")) {
                    // ISO 8601 duration like PT1H, PT30M, PT1H30M
                    endTime = parseDurationEndTime(startTime, endOrDuration);
                } else {
                    endTime = parseICalTime(endOrDuration);
                }

                events.add(new CalDavEvent(null, date, startTime, endTime, fbType, false));
            }
        }

        return events;
    }

    /**
     * Calculates the end time by adding an ISO 8601 duration to a start time.
     * Supports simple durations like {@code PT1H}, {@code PT30M}, {@code PT1H30M}.
     * Returns {@code null} if the start time is null or the duration cannot be parsed.
     */
    private @Nullable LocalTime parseDurationEndTime(@Nullable LocalTime startTime, String duration) {
        if (startTime == null) {
            return null;
        }
        try {
            var javaDuration = Duration.parse(duration);
            return startTime.plus(javaDuration);
        } catch (DateTimeParseException e) {
            log.warn("Failed to parse FREEBUSY duration: {}", duration);
            return null;
        }
    }

    /**
     * Parses an iCalendar date/datetime string into a {@link LocalDate}.
     * Supports formats: {@code 20250210}, {@code 20250210T140000}, {@code 20250210T140000Z}.
     */
    private @Nullable LocalDate parseICalDate(String dtValue) {
        try {
            // Strip timezone suffix
            var clean = dtValue.replace("Z", "").strip();
            if (clean.length() >= 8) {
                return LocalDate.parse(clean.substring(0, 8), ICAL_DATE_FORMATTER);
            }
        } catch (DateTimeParseException e) {
            log.warn("Failed to parse iCal date: {}", dtValue);
        }
        return null;
    }

    /**
     * Parses an iCalendar datetime string into a {@link LocalTime}.
     * Returns {@code null} for date-only values (all-day events).
     * Supports formats: {@code 20250210T140000}, {@code 20250210T140000Z}.
     */
    private @Nullable LocalTime parseICalTime(String dtValue) {
        try {
            var clean = dtValue.replace("Z", "").strip();
            if (clean.contains("T") && clean.length() >= 15) {
                var timeStr = clean.substring(9); // HHmmss
                return LocalTime.of(
                        Integer.parseInt(timeStr.substring(0, 2)),
                        Integer.parseInt(timeStr.substring(2, 4)),
                        Integer.parseInt(timeStr.substring(4, 6)));
            }
        } catch (NumberFormatException | StringIndexOutOfBoundsException e) {
            log.warn("Failed to parse iCal time: {}", dtValue);
        }
        return null;
    }

    /**
     * Represents a principal (user) discovered on the server.
     *
     * @param displayName the display name of the principal
     * @param href        the href/path of the principal's collection
     */
    record Principal(String displayName, String href) {
    }

    /**
     * Discovers all principals on the CalDAV server using the
     * {@code principal-property-search} REPORT method.
     *
     * @param normalizedUrl the base CalDAV URL
     * @param username      the username for authentication
     * @param password      the password for authentication
     * @return a list of all discovered principals
     */
    List<Principal> discoverPrincipals(String normalizedUrl, String username, String password) {
        try {
            var responseBody = sendReport(normalizedUrl, username, password, PRINCIPAL_SEARCH_XML);
            return parsePrincipalSearchResponse(responseBody);
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to discover principals: " + e.getMessage(), e);
        }
    }

    /**
     * Parses a principal-property-search response into a list of principals.
     */
    List<Principal> parsePrincipalSearchResponse(String xml) {
        var principals = new ArrayList<Principal>();
        try {
            var factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            var builder = factory.newDocumentBuilder();
            var document = builder.parse(new InputSource(new StringReader(xml)));

            var responses = document.getElementsByTagNameNS(DAV_NS, "response");
            for (int i = 0; i < responses.getLength(); i++) {
                var response = (Element) responses.item(i);
                var href = getTextContent(response, DAV_NS, "href");
                if (href == null) {
                    continue;
                }

                if (!isSuccessResponse(response)) {
                    continue;
                }

                // Only include actual principals (have <principal/> in resourcetype)
                if (!isPrincipalResource(response)) {
                    continue;
                }

                var displayName = getPropertyText(response, DAV_NS, "displayname");
                if (displayName == null || displayName.isBlank()) {
                    displayName = href;
                }

                principals.add(new Principal(displayName, href));
            }
        } catch (Exception e) {
            throw new CalDavException("Failed to parse principal search response: " + e.getMessage(), e);
        }
        return principals;
    }

    private boolean isPrincipalResource(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var resourceTypes = prop.getElementsByTagNameNS(DAV_NS, "resourcetype");
                for (int k = 0; k < resourceTypes.getLength(); k++) {
                    var resourceType = (Element) resourceTypes.item(k);
                    var principalElements = resourceType.getElementsByTagNameNS(DAV_NS, "principal");
                    if (principalElements.getLength() > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private String sendReport(String normalizedUrl, String username, String password, String reportXml)
            throws IOException, InterruptedException {
        var credentials = Base64.getEncoder().encodeToString(
                (username + ":" + password).getBytes(StandardCharsets.UTF_8));

        var clientBuilder = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NORMAL);

        if (trustAllCertificates) {
            clientBuilder.sslContext(createTrustAllSslContext());
        }

        var httpClient = clientBuilder.build();

        var request = HttpRequest.newBuilder()
                .uri(URI.create(normalizedUrl))
                .method("REPORT", HttpRequest.BodyPublishers.ofString(reportXml))
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "0")
                .header("Authorization", "Basic " + credentials)
                .timeout(REQUEST_TIMEOUT)
                .build();

        log.debug("Sending REPORT principal-property-search to {}", normalizedUrl);
        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        return switch (response.statusCode()) {
            case 207 -> response.body();
            case 401 -> throw new CalDavException("Authentication failed. Please check your username and password.");
            case 403 -> throw new CalDavException("Access denied. You don't have permission to search principals.");
            case 404 -> throw new CalDavException("URL not found. Please check the URL.");
            default -> throw new CalDavException("Server returned unexpected status " + response.statusCode() + ".");
        };
    }

    private boolean isSuccessResponse(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var statusText = getTextContent(propstat, DAV_NS, "status");
            if (statusText != null && statusText.contains("200")) {
                return true;
            }
        }
        return false;
    }

    private @Nullable String getPropertyText(Element response, String namespace, String localName) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var elements = prop.getElementsByTagNameNS(namespace, localName);
                if (elements.getLength() > 0) {
                    var text = elements.item(0).getTextContent();
                    return (text != null && !text.isBlank()) ? text.strip() : null;
                }
            }
        }
        return null;
    }

    private @Nullable String getTextContent(Element parent, String namespace, String localName) {
        var elements = parent.getElementsByTagNameNS(namespace, localName);
        if (elements.getLength() > 0) {
            return elements.item(0).getTextContent();
        }
        return null;
    }

    /**
     * Resolves an href (which may be relative) against the request URL
     * to produce an absolute URL.
     */
    private String resolveHref(String baseUrl, String href) {
        if (href.startsWith("http://") || href.startsWith("https://")) {
            return normalizeUrl(href);
        }
        // href is a path like /caldav.php/username/ - combine with base URL's scheme+host
        var baseUri = URI.create(baseUrl);
        var resolved = baseUri.resolve(href).toString();
        return normalizeUrl(resolved);
    }

    String normalizeUrl(String url) {
        var normalized = url.strip();
        if (!normalized.endsWith("/")) {
            normalized += "/";
        }
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        return normalized;
    }

    /**
     * Creates an {@link SSLContext} that trusts all certificates, including self-signed ones.
     */
    private SSLContext createTrustAllSslContext() {
        try {
            var trustAllManager = new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {
                    // Trust all client certificates
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {
                    // Trust all server certificates
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            };

            var sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new TrustManager[]{trustAllManager}, null);
            return sslContext;
        } catch (NoSuchAlgorithmException | KeyManagementException e) {
            throw new CalDavException("Failed to create SSL context for trusting all certificates.", e);
        }
    }
}
