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
