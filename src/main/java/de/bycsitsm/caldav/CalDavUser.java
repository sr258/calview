package de.bycsitsm.caldav;

/**
 * Represents a user (principal) discovered on a CalDAV server.
 *
 * @param displayName the human-readable name of the user
 * @param href        the URL or path of the user's principal collection
 */
public record CalDavUser(
        String displayName,
        String href
) {
}
