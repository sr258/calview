package de.bycsitsm.caldav;

/**
 * Exception thrown when a CalDAV operation fails.
 */
public class CalDavException extends RuntimeException {

    public CalDavException(String message) {
        super(message);
    }

    public CalDavException(String message, Throwable cause) {
        super(message, cause);
    }
}
