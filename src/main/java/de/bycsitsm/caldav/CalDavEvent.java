package de.bycsitsm.caldav;

import org.jspecify.annotations.Nullable;

import java.time.LocalDate;
import java.time.LocalTime;

/**
 * Represents an event (appointment) from a CalDAV calendar.
 *
 * @param summary     the name/summary of the event, or {@code null} if the calendar is restricted
 * @param date        the date of the event
 * @param startTime   the start time of the event, or {@code null} for all-day events
 * @param endTime     the end time of the event, or {@code null} for all-day events
 * @param status      the visibility/class of the event (e.g. PUBLIC, PRIVATE, CONFIDENTIAL)
 * @param accessible  whether the event details are visible to the current user
 */
public record CalDavEvent(
        @Nullable String summary,
        LocalDate date,
        @Nullable LocalTime startTime,
        @Nullable LocalTime endTime,
        String status,
        boolean accessible
) {
}
