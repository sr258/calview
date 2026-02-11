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
}
