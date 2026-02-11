package de.bycsitsm.caldav;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CalDavClientTest {

    private final CalDavClient client = new CalDavClient(false);

    @Test
    void parsing_principal_search_response_extracts_principals() {
        // Based on actual DAViCal principal-property-search response
        var xml = """
                <?xml version="1.0" encoding="utf-8"?>
                <multistatus xmlns="DAV:">
                  <response>
                    <href>/caldav.php/admin/</href>
                    <propstat>
                      <prop>
                        <displayname>DAViCal Administrator</displayname>
                        <resourcetype>
                          <collection/>
                          <principal/>
                        </resourcetype>
                      </prop>
                      <status>HTTP/1.1 200 OK</status>
                    </propstat>
                  </response>
                  <response>
                    <href>/caldav.php/di57zon/</href>
                    <propstat>
                      <prop>
                        <displayname>Müller, Hans</displayname>
                        <resourcetype>
                          <collection/>
                          <principal/>
                        </resourcetype>
                      </prop>
                      <status>HTTP/1.1 200 OK</status>
                    </propstat>
                  </response>
                  <response>
                    <href>/caldav.php/ISB/</href>
                    <propstat>
                      <prop>
                        <displayname>ISB</displayname>
                        <resourcetype>
                          <collection/>
                          <principal/>
                        </resourcetype>
                      </prop>
                      <status>HTTP/1.1 200 OK</status>
                    </propstat>
                  </response>
                </multistatus>
                """;

        var principals = client.parsePrincipalSearchResponse(xml);

        assertThat(principals).hasSize(3);

        assertThat(principals.get(0).displayName()).isEqualTo("DAViCal Administrator");
        assertThat(principals.get(0).href()).isEqualTo("/caldav.php/admin/");

        assertThat(principals.get(1).displayName()).isEqualTo("Müller, Hans");
        assertThat(principals.get(1).href()).isEqualTo("/caldav.php/di57zon/");

        assertThat(principals.get(2).displayName()).isEqualTo("ISB");
        assertThat(principals.get(2).href()).isEqualTo("/caldav.php/ISB/");
    }

    @Test
    void parsing_principal_search_response_skips_non_principal_resources() {
        var xml = """
                <?xml version="1.0" encoding="utf-8"?>
                <multistatus xmlns="DAV:">
                  <response>
                    <href>/caldav.php/some-collection/</href>
                    <propstat>
                      <prop>
                        <displayname>Just a collection</displayname>
                        <resourcetype>
                          <collection/>
                        </resourcetype>
                      </prop>
                      <status>HTTP/1.1 200 OK</status>
                    </propstat>
                  </response>
                </multistatus>
                """;

        var principals = client.parsePrincipalSearchResponse(xml);

        assertThat(principals).isEmpty();
    }

    @Test
    void parsing_principal_search_response_uses_href_for_missing_displayname() {
        var xml = """
                <?xml version="1.0" encoding="utf-8"?>
                <multistatus xmlns="DAV:">
                  <response>
                    <href>/caldav.php/unnamed/</href>
                    <propstat>
                      <prop>
                        <displayname/>
                        <resourcetype>
                          <collection/>
                          <principal/>
                        </resourcetype>
                      </prop>
                      <status>HTTP/1.1 200 OK</status>
                    </propstat>
                  </response>
                </multistatus>
                """;

        var principals = client.parsePrincipalSearchResponse(xml);

        assertThat(principals).hasSize(1);
        assertThat(principals.get(0).displayName()).isEqualTo("/caldav.php/unnamed/");
    }

    @Test
    void parsing_empty_principal_search_response_returns_empty_list() {
        var xml = """
                <?xml version="1.0" encoding="utf-8"?>
                <multistatus xmlns="DAV:">
                </multistatus>
                """;

        var principals = client.parsePrincipalSearchResponse(xml);

        assertThat(principals).isEmpty();
    }

    @Test
    void building_principal_search_xml_includes_search_term() {
        var xml = client.buildPrincipalSearchXml("Müller");

        assertThat(xml).contains("<d:match>Müller</d:match>");
        assertThat(xml).contains("<d:principal-property-search");
        assertThat(xml).contains("<d:displayname/>");
    }

    @Test
    void building_principal_search_xml_escapes_xml_special_characters() {
        var xml = client.buildPrincipalSearchXml("O'Brien & <Co>");

        assertThat(xml).contains("<d:match>O&apos;Brien &amp; &lt;Co&gt;</d:match>");
        assertThat(xml).doesNotContain("O'Brien & <Co>");
    }

    @Test
    void building_principal_search_xml_handles_empty_search_term() {
        var xml = client.buildPrincipalSearchXml("");

        assertThat(xml).contains("<d:match></d:match>");
    }

    @Test
    void parsing_freebusy_response_extracts_busy_periods() {
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                PRODID:-//Example//NONSGML CalDAV Server//EN
                BEGIN:VFREEBUSY
                DTSTART:20250210T000000Z
                DTEND:20250217T000000Z
                FREEBUSY;FBTYPE=BUSY:20250210T140000Z/20250210T150000Z
                FREEBUSY;FBTYPE=BUSY-TENTATIVE:20250211T090000Z/20250211T100000Z
                FREEBUSY;FBTYPE=BUSY-UNAVAILABLE:20250212T080000Z/20250212T083000Z
                END:VFREEBUSY
                END:VCALENDAR
                """;

        var events = client.parseFreeBusyResponse(ical);

        assertThat(events).hasSize(3);

        // First period: BUSY
        assertThat(events.get(0).summary()).isNull();
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(14, 0));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(15, 0));
        assertThat(events.get(0).status()).isEqualTo("BUSY");
        assertThat(events.get(0).accessible()).isFalse();

        // Second period: BUSY-TENTATIVE
        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 11));
        assertThat(events.get(1).startTime()).isEqualTo(java.time.LocalTime.of(9, 0));
        assertThat(events.get(1).endTime()).isEqualTo(java.time.LocalTime.of(10, 0));
        assertThat(events.get(1).status()).isEqualTo("BUSY-TENTATIVE");
        assertThat(events.get(1).accessible()).isFalse();

        // Third period: BUSY-UNAVAILABLE
        assertThat(events.get(2).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 12));
        assertThat(events.get(2).startTime()).isEqualTo(java.time.LocalTime.of(8, 0));
        assertThat(events.get(2).endTime()).isEqualTo(java.time.LocalTime.of(8, 30));
        assertThat(events.get(2).status()).isEqualTo("BUSY-UNAVAILABLE");
        assertThat(events.get(2).accessible()).isFalse();
    }

    @Test
    void parsing_freebusy_response_with_no_busy_periods_returns_empty_list() {
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                PRODID:-//Example//NONSGML CalDAV Server//EN
                BEGIN:VFREEBUSY
                DTSTART:20250210T000000Z
                DTEND:20250217T000000Z
                END:VFREEBUSY
                END:VCALENDAR
                """;

        var events = client.parseFreeBusyResponse(ical);

        assertThat(events).isEmpty();
    }

    @Test
    void parsing_freebusy_response_handles_multiple_periods_per_line() {
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VFREEBUSY
                FREEBUSY;FBTYPE=BUSY:20250210T140000Z/20250210T150000Z,20250210T160000Z/20250210T170000Z
                END:VFREEBUSY
                END:VCALENDAR
                """;

        var events = client.parseFreeBusyResponse(ical);

        assertThat(events).hasSize(2);

        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(14, 0));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(15, 0));
        assertThat(events.get(0).status()).isEqualTo("BUSY");

        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(1).startTime()).isEqualTo(java.time.LocalTime.of(16, 0));
        assertThat(events.get(1).endTime()).isEqualTo(java.time.LocalTime.of(17, 0));
        assertThat(events.get(1).status()).isEqualTo("BUSY");
    }

    @Test
    void parsing_freebusy_response_handles_duration_format() {
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VFREEBUSY
                FREEBUSY;FBTYPE=BUSY:20250210T140000Z/PT1H30M
                END:VFREEBUSY
                END:VCALENDAR
                """;

        var events = client.parseFreeBusyResponse(ical);

        assertThat(events).hasSize(1);
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(14, 0));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(15, 30));
        assertThat(events.get(0).status()).isEqualTo("BUSY");
    }

    @Test
    void parsing_freebusy_response_defaults_to_busy_when_no_fbtype() {
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VFREEBUSY
                FREEBUSY:20250210T140000Z/20250210T150000Z
                END:VFREEBUSY
                END:VCALENDAR
                """;

        var events = client.parseFreeBusyResponse(ical);

        assertThat(events).hasSize(1);
        assertThat(events.get(0).status()).isEqualTo("BUSY");
    }

    @Test
    void parsing_freebusy_response_without_vfreebusy_block_returns_empty() {
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                END:VCALENDAR
                """;

        var events = client.parseFreeBusyResponse(ical);

        assertThat(events).isEmpty();
    }

    @Test
    void parsing_freebusy_response_handles_actual_davical_format() {
        // Exact response format from DAViCal server
        var ical = """
                BEGIN:VCALENDAR
                PRODID:-//davical.org//NONSGML AWL Calendar//EN
                VERSION:2.0
                CALSCALE:GREGORIAN
                BEGIN:VFREEBUSY
                DTSTAMP:20260211T152112Z
                DTSTART:20260209T000000Z
                DTEND:20260216T000000Z
                FREEBUSY:20260210T093000Z/20260210T110000Z
                FREEBUSY:20260211T073000Z/20260211T080000Z
                END:VFREEBUSY
                END:VCALENDAR
                """;

        var events = client.parseFreeBusyResponse(ical);

        assertThat(events).hasSize(2);

        assertThat(events.get(0).summary()).isNull();
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2026, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(9, 30));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(11, 0));
        assertThat(events.get(0).status()).isEqualTo("BUSY");
        assertThat(events.get(0).accessible()).isFalse();

        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2026, 2, 11));
        assertThat(events.get(1).startTime()).isEqualTo(java.time.LocalTime.of(7, 30));
        assertThat(events.get(1).endTime()).isEqualTo(java.time.LocalTime.of(8, 0));
        assertThat(events.get(1).status()).isEqualTo("BUSY");
        assertThat(events.get(1).accessible()).isFalse();
    }

    // =========================================================================
    // Expanded recurring event parsing tests
    // =========================================================================

    @Test
    void parsing_expanded_recurring_event_returns_individual_occurrences() {
        // When the server expands a weekly recurring event with <c:expand>,
        // it returns one VEVENT per occurrence with concrete UTC times and
        // RECURRENCE-ID for non-initial instances. No RRULE is present.
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                PRODID:-//Example//NONSGML CalDAV Server//EN
                BEGIN:VEVENT
                DTSTART:20250210T100000Z
                DTEND:20250210T110000Z
                SUMMARY:Weekly Meeting
                RECURRENCE-ID:20250210T100000Z
                UID:recurring-1@example.com
                END:VEVENT
                BEGIN:VEVENT
                DTSTART:20250212T100000Z
                DTEND:20250212T110000Z
                SUMMARY:Weekly Meeting
                RECURRENCE-ID:20250212T100000Z
                UID:recurring-1@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(2);

        assertThat(events.get(0).summary()).isEqualTo("Weekly Meeting");
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(10, 0));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(11, 0));
        assertThat(events.get(0).accessible()).isTrue();

        assertThat(events.get(1).summary()).isEqualTo("Weekly Meeting");
        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 12));
        assertThat(events.get(1).startTime()).isEqualTo(java.time.LocalTime.of(10, 0));
        assertThat(events.get(1).endTime()).isEqualTo(java.time.LocalTime.of(11, 0));
        assertThat(events.get(1).accessible()).isTrue();
    }

    @Test
    void parsing_expanded_recurring_event_with_overridden_instance() {
        // A recurring event where one occurrence has been modified (e.g., moved
        // to a different time). The server returns the modified instance with
        // its own DTSTART/DTEND.
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART:20250210T100000Z
                DTEND:20250210T110000Z
                SUMMARY:Weekly Meeting
                RECURRENCE-ID:20250210T100000Z
                UID:recurring-2@example.com
                END:VEVENT
                BEGIN:VEVENT
                DTSTART:20250217T140000Z
                DTEND:20250217T150000Z
                SUMMARY:Weekly Meeting (moved)
                RECURRENCE-ID:20250217T100000Z
                UID:recurring-2@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(2);

        // First occurrence: normal time
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(10, 0));
        assertThat(events.get(0).summary()).isEqualTo("Weekly Meeting");

        // Second occurrence: moved to 14:00
        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 17));
        assertThat(events.get(1).startTime()).isEqualTo(java.time.LocalTime.of(14, 0));
        assertThat(events.get(1).endTime()).isEqualTo(java.time.LocalTime.of(15, 0));
        assertThat(events.get(1).summary()).isEqualTo("Weekly Meeting (moved)");
    }

    @Test
    void parsing_expanded_all_day_recurring_event() {
        // An expanded all-day recurring event uses VALUE=DATE format
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART;VALUE=DATE:20250210
                DTEND;VALUE=DATE:20250211
                SUMMARY:Daily Standup
                RECURRENCE-ID;VALUE=DATE:20250210
                UID:allday-recurring@example.com
                END:VEVENT
                BEGIN:VEVENT
                DTSTART;VALUE=DATE:20250211
                DTEND;VALUE=DATE:20250212
                SUMMARY:Daily Standup
                RECURRENCE-ID;VALUE=DATE:20250211
                UID:allday-recurring@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(2);

        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isNull(); // all-day
        assertThat(events.get(0).endTime()).isNull(); // all-day
        assertThat(events.get(0).summary()).isEqualTo("Daily Standup");

        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 11));
        assertThat(events.get(1).startTime()).isNull();
        assertThat(events.get(1).endTime()).isNull();
    }

    @Test
    void parsing_calendar_query_response_with_expanded_recurring_events() {
        // Full multistatus XML response with expanded recurring event data,
        // as returned by a calendar-query with <c:expand>
        var xml = """
                <?xml version="1.0" encoding="utf-8"?>
                <multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                  <response>
                    <href>/caldav.php/user/calendar/recurring-event.ics</href>
                    <propstat>
                      <prop>
                        <getetag>"etag-123"</getetag>
                        <C:calendar-data>BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART:20250210T090000Z
                DTEND:20250210T100000Z
                SUMMARY:Team Sync
                RECURRENCE-ID:20250210T090000Z
                UID:weekly-sync@example.com
                END:VEVENT
                BEGIN:VEVENT
                DTSTART:20250214T090000Z
                DTEND:20250214T100000Z
                SUMMARY:Team Sync
                RECURRENCE-ID:20250214T090000Z
                UID:weekly-sync@example.com
                END:VEVENT
                END:VCALENDAR
                </C:calendar-data>
                      </prop>
                      <status>HTTP/1.1 200 OK</status>
                    </propstat>
                  </response>
                </multistatus>
                """;

        var events = client.parseCalendarQueryResponse(xml, true);

        assertThat(events).hasSize(2);

        assertThat(events.get(0).summary()).isEqualTo("Team Sync");
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(9, 0));

        assertThat(events.get(1).summary()).isEqualTo("Team Sync");
        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 14));
        assertThat(events.get(1).startTime()).isEqualTo(java.time.LocalTime.of(9, 0));
    }

    // =========================================================================
    // DURATION property parsing tests
    // =========================================================================

    @Test
    void parsing_event_with_duration_instead_of_dtend() {
        // Some servers (especially when expanding recurring events) use
        // DURATION instead of DTEND
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART:20250210T100000Z
                DURATION:PT1H
                SUMMARY:One Hour Meeting
                UID:duration-1@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(1);
        assertThat(events.get(0).summary()).isEqualTo("One Hour Meeting");
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(10, 0));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(11, 0));
    }

    @Test
    void parsing_event_with_duration_90_minutes() {
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART:20250210T140000Z
                DURATION:PT1H30M
                SUMMARY:Long Meeting
                UID:duration-2@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(1);
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(14, 0));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(15, 30));
    }

    @Test
    void parsing_event_prefers_dtend_over_duration() {
        // Per RFC 5545, DTEND and DURATION are mutually exclusive, but
        // if both are present we should prefer DTEND
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART:20250210T100000Z
                DTEND:20250210T113000Z
                DURATION:PT1H
                SUMMARY:Conflicting Props
                UID:both@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(1);
        // DTEND takes precedence
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(11, 30));
    }

    @Test
    void parsing_expanded_recurring_event_with_duration() {
        // Typical DAViCal expanded response: recurring event uses DURATION
        // instead of DTEND, each occurrence is a separate VEVENT
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART:20250210T090000Z
                DURATION:PT1H
                SUMMARY:Weekly Standup
                RECURRENCE-ID:20250210T090000Z
                UID:weekly-standup@example.com
                END:VEVENT
                BEGIN:VEVENT
                DTSTART:20250217T090000Z
                DURATION:PT1H
                SUMMARY:Weekly Standup
                RECURRENCE-ID:20250217T090000Z
                UID:weekly-standup@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(2);

        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isEqualTo(java.time.LocalTime.of(9, 0));
        assertThat(events.get(0).endTime()).isEqualTo(java.time.LocalTime.of(10, 0));
        assertThat(events.get(0).summary()).isEqualTo("Weekly Standup");

        assertThat(events.get(1).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 17));
        assertThat(events.get(1).startTime()).isEqualTo(java.time.LocalTime.of(9, 0));
        assertThat(events.get(1).endTime()).isEqualTo(java.time.LocalTime.of(10, 0));
    }

    @Test
    void parsing_all_day_event_without_duration_remains_all_day() {
        // All-day events have no time component — DURATION should not interfere
        var ical = """
                BEGIN:VCALENDAR
                VERSION:2.0
                BEGIN:VEVENT
                DTSTART;VALUE=DATE:20250210
                SUMMARY:Holiday
                UID:allday@example.com
                END:VEVENT
                END:VCALENDAR
                """;

        var events = client.parseICalendarData(ical, true);

        assertThat(events).hasSize(1);
        assertThat(events.get(0).date()).isEqualTo(java.time.LocalDate.of(2025, 2, 10));
        assertThat(events.get(0).startTime()).isNull();
        assertThat(events.get(0).endTime()).isNull();
    }
}
