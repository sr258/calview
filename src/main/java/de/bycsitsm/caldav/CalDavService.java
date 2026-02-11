package de.bycsitsm.caldav;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
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
     * Searches for users (principals) on the CalDAV server whose display name
     * matches the given search term. The search is performed server-side using
     * the {@code principal-property-search} REPORT method.
     * <p>
     * This is preferred over {@link #discoverUsers} when the server limits
     * the number of results (e.g. DAViCal limits REPORT responses to 100 entries).
     *
     * @param url        the CalDAV URL to connect to (typically the server root)
     * @param username   the username for authentication
     * @param password   the password for authentication
     * @param searchTerm the search term to match against display names (minimum 1 character)
     * @return a list of matching users
     * @throws CalDavException if validation fails or the search cannot be performed
     */
    public List<CalDavUser> searchUsers(String url, String username, String password, String searchTerm) {
        validateInputs(url, username, password);
        if (searchTerm == null || searchTerm.isBlank()) {
            throw new CalDavException("Search term must not be empty.");
        }

        log.info("Searching users at {} with term '{}' for user {}", url, searchTerm, username);
        var users = calDavClient.searchUsers(url, username, password, searchTerm);
        log.info("Found {} user(s) matching '{}' at {}", users.size(), searchTerm, url);

        return users;
    }

    /**
     * Fetches events for the specified week from a specific user's default calendar.
     * <p>
     * Uses a smart fallback strategy: first attempts a {@code calendar-query}
     * for full event details (name, time, status). If access is denied, falls
     * back to a {@code free-busy-query} for busy time slots only.
     *
     * @param baseUrl   the base CalDAV URL used for the original connection
     * @param userHref  the href of the user's principal collection
     * @param username  the username for authentication
     * @param password  the password for authentication
     * @param weekStart the Monday of the week to fetch events for
     * @return a list of events for the specified week, sorted by date and time
     * @throws CalDavException if validation fails or events cannot be fetched
     */
    public List<CalDavEvent> fetchWeekEvents(String baseUrl, String userHref, String username, String password,
                                             LocalDate weekStart) {
        validateInputs(baseUrl, username, password);

        log.info("Fetching week events for user at {} (week of {})", userHref, weekStart);
        var events = calDavClient.fetchWeekEvents(baseUrl, userHref, username, password, weekStart);

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
