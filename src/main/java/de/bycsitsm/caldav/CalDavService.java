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
     * Connects to a CalDAV server and discovers all users (principals).
     * Uses the {@code principal-property-search} REPORT to enumerate
     * all principals on the server.
     *
     * @param url      the CalDAV URL to connect to (typically the server root)
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of all discovered users
     * @throws CalDavException if validation fails or the connection cannot be established
     */
    public List<CalDavUser> discoverUsers(String url, String username, String password) {
        validateInputs(url, username, password);

        log.info("Discovering users at {} for user {}", url, username);
        var users = calDavClient.discoverUsers(url, username, password);
        log.info("Discovered {} user(s) at {}", users.size(), url);

        return users;
    }

    /**
     * Fetches events for the current week from a specific user's default calendar.
     * <p>
     * Uses a smart fallback strategy: first attempts a {@code calendar-query}
     * for full event details (name, time, status). If access is denied, falls
     * back to a {@code free-busy-query} for busy time slots only.
     *
     * @param baseUrl  the base CalDAV URL used for the original connection
     * @param userHref the href of the user's principal collection
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of events for the current week, sorted by date and time
     * @throws CalDavException if validation fails or events cannot be fetched
     */
    public List<CalDavEvent> fetchWeekEvents(String baseUrl, String userHref, String username, String password) {
        validateInputs(baseUrl, username, password);

        log.info("Fetching week events for user at {}", userHref);
        var events = calDavClient.fetchWeekEvents(baseUrl, userHref, username, password);

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

        log.info("Found {} event(s) for the current week for user at {}", events.size(), userHref);
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
