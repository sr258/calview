package de.bycsitsm.caldav;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Service layer for CalDAV operations. Validates inputs and delegates
 * to {@link CalDavClient} for protocol-level communication.
 */
@Service
public class CalDavService {

    private static final Logger log = LoggerFactory.getLogger(CalDavService.class);

    private final CalDavClient calDavClient;

    CalDavService(CalDavClient calDavClient) {
        this.calDavClient = calDavClient;
    }

    /**
     * Connects to a CalDAV server and discovers available calendars.
     *
     * @param url      the CalDAV URL to connect to
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of discovered calendars
     * @throws CalDavException if validation fails or the connection cannot be established
     */
    public List<CalDavCalendar> discoverCalendars(String url, String username, String password) {
        validateInputs(url, username, password);

        log.info("Discovering calendars at {} for user {}", url, username);
        var calendars = calDavClient.discoverCalendars(url, username, password);
        log.info("Discovered {} calendar(s) at {}", calendars.size(), url);

        return calendars;
    }

    /**
     * Connects to a CalDAV server and discovers all calendars, including
     * those belonging to principals whose calendars are not shared with
     * the current user. Uses the {@code principal-property-search} REPORT
     * to enumerate all principals, then queries each for their calendars.
     * <p>
     * Principals that deny access (HTTP 403) are included as inaccessible
     * entries with {@code accessible=false}.
     *
     * @param url      the CalDAV URL to connect to (typically the server root)
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of all calendars, including inaccessible ones
     * @throws CalDavException if validation fails or the connection cannot be established
     */
    public List<CalDavCalendar> discoverAllCalendars(String url, String username, String password) {
        validateInputs(url, username, password);

        log.info("Discovering all calendars (including inaccessible) at {} for user {}", url, username);
        var calendars = calDavClient.discoverAllCalendars(url, username, password);

        var accessible = calendars.stream().filter(CalDavCalendar::accessible).count();
        var inaccessible = calendars.size() - accessible;
        log.info("Discovered {} calendar(s) at {} ({} accessible, {} inaccessible)",
                calendars.size(), url, accessible, inaccessible);

        return calendars;
    }

    /**
     * Fetches events for the current week from a specific calendar.
     * <p>
     * For accessible calendars, event details (name, time, status) are returned.
     * For restricted calendars, the service still attempts to fetch events but
     * the event names will be hidden (returned as {@code null} in
     * {@link CalDavEvent#summary()}).
     *
     * @param baseUrl      the base CalDAV URL used for the original connection
     * @param calendarHref the href of the calendar to fetch events from
     * @param username     the username for authentication
     * @param password     the password for authentication
     * @param accessible   whether the calendar is accessible to the current user
     * @return a list of events for the current week, sorted by date and time
     * @throws CalDavException if validation fails or events cannot be fetched
     */
    public List<CalDavEvent> fetchWeekEvents(String baseUrl, String calendarHref, String username, String password, boolean accessible) {
        validateInputs(baseUrl, username, password);

        log.info("Fetching week events from {} (accessible: {})", calendarHref, accessible);
        var events = calDavClient.fetchWeekEvents(baseUrl, calendarHref, username, password, accessible);

        // Sort by date, then by time (all-day events first)
        events.sort((a, b) -> {
            var dateCompare = a.date().compareTo(b.date());
            if (dateCompare != 0) {
                return dateCompare;
            }
            if (a.startTime() == null && b.startTime() == null) {
                return 0;
            }
            if (a.startTime() == null) {
                return -1;
            }
            if (b.startTime() == null) {
                return 1;
            }
            return a.startTime().compareTo(b.startTime());
        });

        log.info("Found {} event(s) for the current week in {}", events.size(), calendarHref);
        return events;
    }

    private void validateInputs(String url, String username, String password) {
        if (url == null || url.isBlank()) {
            throw new CalDavException("CalDAV URL must not be empty.");
        }
        if (username == null || username.isBlank()) {
            throw new CalDavException("Username must not be empty.");
        }
        if (password == null || password.isBlank()) {
            throw new CalDavException("Password must not be empty.");
        }
    }
}
