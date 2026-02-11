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
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Low-level CalDAV protocol client that communicates with CalDAV servers
 * using Java's built-in {@link HttpClient}.
 * <p>
 * Supports PROPFIND requests for calendar discovery, including two-level
 * discovery where the given URL points to a server root containing principals
 * rather than calendars directly (e.g. DAViCal's {@code /caldav.php/}).
 * <p>
 * Also supports discovering all principals on the server via the
 * {@code principal-property-search} REPORT method (RFC 3744), which allows
 * listing calendars from users whose calendars are not shared with the
 * current user.
 */
@Component
class CalDavClient {

    private static final Logger log = LoggerFactory.getLogger(CalDavClient.class);

    private static final String DAV_NS = "DAV:";
    private static final String CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
    private static final String APPLE_ICAL_NS = "http://apple.com/ns/ical/";
    private static final String CALENDARSERVER_NS = "http://calendarserver.org/ns/";

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
     * XML body for a PROPFIND request that discovers calendars and collections.
     */
    private static final String PROPFIND_CALENDARS_XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <d:propfind xmlns:d="DAV:"
                        xmlns:cs="http://calendarserver.org/ns/"
                        xmlns:c="urn:ietf:params:xml:ns:caldav"
                        xmlns:ic="http://apple.com/ns/ical/">
              <d:prop>
                <d:displayname/>
                <d:resourcetype/>
                <c:calendar-description/>
                <ic:calendar-color/>
                <cs:getctag/>
              </d:prop>
            </d:propfind>
            """;

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
     * Discovers all calendars accessible from the given CalDAV URL.
     * <p>
     * If the URL points directly at a principal's collection (e.g.
     * {@code /caldav.php/username/}), calendars are returned directly.
     * <p>
     * If the URL points at a server root containing principals (e.g.
     * {@code /caldav.php/}), a two-level discovery is performed: first
     * the principals are listed, then each principal is queried for its
     * calendars.
     *
     * @param url      the CalDAV URL
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of all discovered calendars
     * @throws CalDavException if the request fails or the response cannot be parsed
     */
    List<CalDavCalendar> discoverCalendars(String url, String username, String password) {
        try {
            var normalizedUrl = normalizeUrl(url);
            var responseBody = sendPropfind(normalizedUrl, username, password);
            var parseResult = parseMultistatusResponse(responseBody, normalizedUrl);

            if (!parseResult.calendars.isEmpty()) {
                // Found calendars directly - URL pointed at a principal's collection
                return parseResult.calendars;
            }

            if (!parseResult.childCollections.isEmpty()) {
                // Found sub-collections but no calendars - likely principals.
                // Query each one for calendars.
                log.debug("No calendars found directly at {}, querying {} sub-collection(s)",
                        normalizedUrl, parseResult.childCollections.size());
                var allCalendars = new ArrayList<CalDavCalendar>();
                for (var collectionHref : parseResult.childCollections) {
                    var collectionUrl = resolveHref(normalizedUrl, collectionHref);
                    try {
                        var childResponse = sendPropfind(collectionUrl, username, password);
                        var childResult = parseMultistatusResponse(childResponse, collectionUrl);
                        allCalendars.addAll(childResult.calendars);
                    } catch (CalDavException e) {
                        log.warn("Failed to query sub-collection {}: {}", collectionUrl, e.getMessage());
                        // Continue with other collections
                    }
                }
                return allCalendars;
            }

            return List.of();
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to discover calendars: " + e.getMessage(), e);
        }
    }

    /**
     * Discovers all principals on the server and then queries each one for
     * calendars, including principals whose calendars are not shared with the
     * current user.
     * <p>
     * For principals that the current user cannot access (HTTP 403), a single
     * placeholder calendar entry is created with {@code accessible=false},
     * using the principal's display name.
     * <p>
     * For accessible principals, their calendars are returned with
     * {@code accessible=true} and the principal's display name as the owner.
     *
     * @param url      the CalDAV URL (typically the server root, e.g. {@code /caldav.php/})
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of all calendars, including inaccessible ones
     * @throws CalDavException if the principal search fails
     */
    List<CalDavCalendar> discoverAllCalendars(String url, String username, String password) {
        try {
            var normalizedUrl = normalizeUrl(url);
            var principals = discoverPrincipals(normalizedUrl, username, password);

            if (principals.isEmpty()) {
                log.info("No principals found, falling back to standard calendar discovery");
                return discoverCalendars(url, username, password);
            }

            log.info("Found {} principal(s), querying each for calendars", principals.size());
            var allCalendars = new ArrayList<CalDavCalendar>();

            for (var principal : principals) {
                var principalUrl = resolveHref(normalizedUrl, principal.href());
                try {
                    var responseBody = sendPropfind(principalUrl, username, password);
                    var parseResult = parseMultistatusResponse(responseBody, principalUrl);

                    for (var calendar : parseResult.calendars) {
                        allCalendars.add(new CalDavCalendar(
                                calendar.displayName(),
                                calendar.href(),
                                calendar.description(),
                                calendar.color(),
                                calendar.ctag(),
                                principal.displayName(),
                                true
                        ));
                    }
                } catch (CalDavException e) {
                    if (e.getMessage() != null && e.getMessage().contains("Access denied")) {
                        // Principal exists but calendars are not shared with us.
                        // Use the default calendar collection path (principal href + "calendar/")
                        // because free-busy-query must target a calendar resource, not the principal.
                        var calendarHref = principal.href().endsWith("/")
                                ? principal.href() + "calendar/"
                                : principal.href() + "/calendar/";
                        log.debug("No access to principal {}, using calendar href: {}",
                                principal.displayName(), calendarHref);
                        allCalendars.add(new CalDavCalendar(
                                principal.displayName(),
                                calendarHref,
                                null,
                                null,
                                null,
                                principal.displayName(),
                                false
                        ));
                    } else {
                        log.warn("Failed to query principal {}: {}", principal.displayName(), e.getMessage());
                    }
                }
            }

            return allCalendars;
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to discover all calendars: " + e.getMessage(), e);
        }
    }

    /**
     * Fetches events for the current week from the given calendar.
     * <p>
     * Uses a CalDAV REPORT {@code calendar-query} with a time-range filter
     * to retrieve VEVENT components for the current week (Monday to Sunday).
     * The response contains raw iCalendar data which is parsed into
     * {@link CalDavEvent} records.
     * <p>
     * The {@code calendarHref} may be a relative path (e.g. {@code /caldav.php/user/calendar/})
     * as returned by the server in PROPFIND responses. It is resolved against
     * the {@code baseUrl} to produce the full URL.
     *
     * @param baseUrl      the base CalDAV URL used for the original connection
     * @param calendarHref the href of the calendar (absolute URL or relative path)
     * @param username     the username for authentication
     * @param password     the password for authentication
     * @param accessible   whether the calendar is accessible (affects event detail visibility)
     * @return a list of events for the current week
     * @throws CalDavException if the request fails or the response cannot be parsed
     */
    List<CalDavEvent> fetchWeekEvents(String baseUrl, String calendarHref, String username, String password, boolean accessible) {
        try {
            var normalizedBase = normalizeUrl(baseUrl);
            var normalizedUrl = resolveHref(normalizedBase, calendarHref);
            var today = LocalDate.now();
            var weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            var weekEnd = weekStart.plusDays(7); // exclusive: Monday of next week

            var startStr = weekStart.format(ICAL_DATE_FORMATTER) + "T000000Z";
            var endStr = weekEnd.format(ICAL_DATE_FORMATTER) + "T000000Z";

            if (accessible) {
                var reportXml = CALENDAR_QUERY_XML_TEMPLATE
                        .replace("{{START}}", startStr)
                        .replace("{{END}}", endStr);
                var responseBody = sendCalendarReport(normalizedUrl, username, password, reportXml);
                return parseCalendarQueryResponse(responseBody, true);
            } else {
                var reportXml = FREE_BUSY_QUERY_XML_TEMPLATE
                        .replace("{{START}}", startStr)
                        .replace("{{END}}", endStr);
                var responseBody = sendFreeBusyReport(normalizedUrl, username, password, reportXml);
                return parseFreeBusyResponse(responseBody);
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
            // But extractICalProperty already handles this for single-value properties.
            // For FREEBUSY, the full line looks like:
            //   FREEBUSY;FBTYPE=BUSY:20250210T140000Z/20250210T150000Z
            // After the pattern match, group(1) is "FBTYPE=BUSY:20250210T140000Z/20250210T150000Z"
            // or just "20250210T140000Z/20250210T150000Z" if no params.
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
            var responseBody = sendReport(normalizedUrl, username, password);
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

    private String sendPropfind(String normalizedUrl, String username, String password)
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
                .method("PROPFIND", HttpRequest.BodyPublishers.ofString(PROPFIND_CALENDARS_XML))
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "1")
                .header("Authorization", "Basic " + credentials)
                .timeout(REQUEST_TIMEOUT)
                .build();

        log.debug("Sending PROPFIND to {}", normalizedUrl);
        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        return switch (response.statusCode()) {
            case 207 -> response.body();
            case 401 -> throw new CalDavException("Authentication failed. Please check your username and password.");
            case 403 -> throw new CalDavException("Access denied. You don't have permission to access this calendar.");
            case 404 -> throw new CalDavException("Calendar URL not found. Please check the URL.");
            default -> throw new CalDavException("Server returned unexpected status " + response.statusCode() + ".");
        };
    }

    private String sendReport(String normalizedUrl, String username, String password)
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
                .method("REPORT", HttpRequest.BodyPublishers.ofString(PRINCIPAL_SEARCH_XML))
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

    /**
     * Result of parsing a PROPFIND multistatus response. Contains both
     * discovered calendars and non-calendar child collections (principals).
     */
    record PropfindResult(List<CalDavCalendar> calendars, List<String> childCollections) {
    }

    PropfindResult parseMultistatusResponse(String xml, String requestUrl) {
        var calendars = new ArrayList<CalDavCalendar>();
        var childCollections = new ArrayList<String>();
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

                // Skip the response for the collection itself
                if (isSameResource(href, requestUrl)) {
                    continue;
                }

                // Only process successful responses
                if (!isSuccessResponse(response)) {
                    continue;
                }

                if (isCalendarResource(response)) {
                    var calendar = parseCalendarFromResponse(response, href);
                    if (calendar != null) {
                        calendars.add(calendar);
                    }
                } else if (isCollectionResource(response)) {
                    childCollections.add(href);
                }
            }
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to parse server response: " + e.getMessage(), e);
        }
        return new PropfindResult(calendars, childCollections);
    }

    private @Nullable CalDavCalendar parseCalendarFromResponse(Element response, String href) {
        var displayName = getPropertyText(response, DAV_NS, "displayname");
        var description = getPropertyText(response, CALDAV_NS, "calendar-description");
        var color = getPropertyText(response, APPLE_ICAL_NS, "calendar-color");
        var ctag = getPropertyText(response, CALENDARSERVER_NS, "getctag");

        // Use href as display name fallback
        if (displayName == null || displayName.isBlank()) {
            displayName = href;
        }

        // Normalize color to 7-char hex if it has alpha channel (#RRGGBBAA -> #RRGGBB)
        if (color != null && color.length() == 9 && color.startsWith("#")) {
            color = color.substring(0, 7);
        }

        return new CalDavCalendar(displayName, href, description, color, ctag, null, true);
    }

    private boolean isCalendarResource(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var resourceTypes = prop.getElementsByTagNameNS(DAV_NS, "resourcetype");
                for (int k = 0; k < resourceTypes.getLength(); k++) {
                    var resourceType = (Element) resourceTypes.item(k);
                    var calendarElements = resourceType.getElementsByTagNameNS(CALDAV_NS, "calendar");
                    if (calendarElements.getLength() > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private boolean isCollectionResource(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var resourceTypes = prop.getElementsByTagNameNS(DAV_NS, "resourcetype");
                for (int k = 0; k < resourceTypes.getLength(); k++) {
                    var resourceType = (Element) resourceTypes.item(k);
                    var collectionElements = resourceType.getElementsByTagNameNS(DAV_NS, "collection");
                    if (collectionElements.getLength() > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
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

    private boolean isSameResource(String href, String requestUrl) {
        var normalizedHref = href.replaceAll("/+$", "");
        var normalizedUrl = requestUrl.replaceAll("/+$", "");

        if (normalizedUrl.endsWith(normalizedHref)) {
            return true;
        }

        try {
            var hrefPath = URI.create(normalizedHref).getPath();
            var urlPath = URI.create(normalizedUrl).getPath();
            if (hrefPath != null && urlPath != null) {
                return hrefPath.replaceAll("/+$", "").equals(urlPath.replaceAll("/+$", ""));
            }
        } catch (IllegalArgumentException e) {
            // If we can't parse, fall through to simple comparison
        }
        return normalizedHref.equals(normalizedUrl);
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
