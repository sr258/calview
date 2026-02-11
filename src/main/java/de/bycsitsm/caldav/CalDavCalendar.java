package de.bycsitsm.caldav;

import org.jspecify.annotations.Nullable;

/**
 * Represents a calendar discovered from a CalDAV server.
 *
 * @param displayName the human-readable name of the calendar
 * @param href        the URL or path of the calendar resource
 * @param description an optional description of the calendar
 * @param color       an optional color (hex string like {@code #FF0000FF})
 * @param ctag        an optional CTag for change detection
 * @param owner       the display name of the principal that owns this calendar
 * @param accessible  whether the current user has read access to this calendar
 */
public record CalDavCalendar(
        String displayName,
        String href,
        @Nullable String description,
        @Nullable String color,
        @Nullable String ctag,
        @Nullable String owner,
        boolean accessible
) {
}
