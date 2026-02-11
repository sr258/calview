package de.bycsitsm.caldav;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CalDavClientTest {

    private final CalDavClient client = new CalDavClient(false);

    @Test
    void parsing_multistatus_with_calendars_extracts_calendar_info() throws Exception {
        // Simulate a typical CalDAV PROPFIND 207 Multi-Status response
        var xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <d:multistatus xmlns:d="DAV:"
                               xmlns:cs="http://calendarserver.org/ns/"
                               xmlns:c="urn:ietf:params:xml:ns:caldav"
                               xmlns:ic="http://apple.com/ns/ical/">
                  <d:response>
                    <d:href>/dav/calendars/user/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>User Calendars</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                        </d:resourcetype>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                  <d:response>
                    <d:href>/dav/calendars/user/personal/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>Personal</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                          <c:calendar/>
                        </d:resourcetype>
                        <c:calendar-description>My personal calendar</c:calendar-description>
                        <ic:calendar-color>#0000FFFF</ic:calendar-color>
                        <cs:getctag>ctag-12345</cs:getctag>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                  <d:response>
                    <d:href>/dav/calendars/user/work/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>Work</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                          <c:calendar/>
                        </d:resourcetype>
                        <c:calendar-description>Work calendar</c:calendar-description>
                        <ic:calendar-color>#FF0000</ic:calendar-color>
                        <cs:getctag>ctag-67890</cs:getctag>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                </d:multistatus>
                """;

        var calendars = invokeParseMultistatus(xml, "https://example.com/dav/calendars/user/");

        assertThat(calendars).hasSize(2);

        var personal = calendars.get(0);
        assertThat(personal.displayName()).isEqualTo("Personal");
        assertThat(personal.href()).isEqualTo("/dav/calendars/user/personal/");
        assertThat(personal.description()).isEqualTo("My personal calendar");
        assertThat(personal.color()).isEqualTo("#0000FF"); // Alpha stripped
        assertThat(personal.ctag()).isEqualTo("ctag-12345");
        assertThat(personal.accessible()).isTrue();
        assertThat(personal.owner()).isNull();

        var work = calendars.get(1);
        assertThat(work.displayName()).isEqualTo("Work");
        assertThat(work.href()).isEqualTo("/dav/calendars/user/work/");
        assertThat(work.description()).isEqualTo("Work calendar");
        assertThat(work.color()).isEqualTo("#FF0000"); // No alpha, stays as-is
        assertThat(work.ctag()).isEqualTo("ctag-67890");
        assertThat(work.accessible()).isTrue();
        assertThat(work.owner()).isNull();
    }

    @Test
    void parsing_multistatus_skips_non_calendar_resources() throws Exception {
        var xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <d:multistatus xmlns:d="DAV:"
                               xmlns:c="urn:ietf:params:xml:ns:caldav">
                  <d:response>
                    <d:href>/dav/calendars/user/contacts/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>Contacts</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                        </d:resourcetype>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                </d:multistatus>
                """;

        var calendars = invokeParseMultistatus(xml, "https://example.com/dav/");

        assertThat(calendars).isEmpty();
    }

    @Test
    void parsing_multistatus_skips_parent_collection() throws Exception {
        var xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <d:multistatus xmlns:d="DAV:"
                               xmlns:c="urn:ietf:params:xml:ns:caldav">
                  <d:response>
                    <d:href>/dav/calendars/user/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>All Calendars</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                          <c:calendar/>
                        </d:resourcetype>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                </d:multistatus>
                """;

        var calendars = invokeParseMultistatus(xml, "https://example.com/dav/calendars/user/");

        assertThat(calendars).isEmpty();
    }

    @Test
    void parsing_empty_multistatus_returns_empty_list() throws Exception {
        var xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <d:multistatus xmlns:d="DAV:">
                </d:multistatus>
                """;

        var calendars = invokeParseMultistatus(xml, "https://example.com/dav/");

        assertThat(calendars).isEmpty();
    }

    @Test
    void calendar_without_display_name_uses_href_as_fallback() throws Exception {
        var xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <d:multistatus xmlns:d="DAV:"
                               xmlns:c="urn:ietf:params:xml:ns:caldav">
                  <d:response>
                    <d:href>/dav/calendars/user/unnamed/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname/>
                        <d:resourcetype>
                          <d:collection/>
                          <c:calendar/>
                        </d:resourcetype>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                </d:multistatus>
                """;

        var calendars = invokeParseMultistatus(xml, "https://example.com/dav/calendars/user/");

        assertThat(calendars).hasSize(1);
        assertThat(calendars.get(0).displayName()).isEqualTo("/dav/calendars/user/unnamed/");
    }

    @Test
    void parsing_multistatus_extracts_child_collections() throws Exception {
        var xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <d:multistatus xmlns:d="DAV:"
                               xmlns:c="urn:ietf:params:xml:ns:caldav">
                  <d:response>
                    <d:href>/caldav.php/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>Root</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                        </d:resourcetype>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                  <d:response>
                    <d:href>/caldav.php/alice/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>Alice</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                        </d:resourcetype>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                  <d:response>
                    <d:href>/caldav.php/bob/</d:href>
                    <d:propstat>
                      <d:prop>
                        <d:displayname>Bob</d:displayname>
                        <d:resourcetype>
                          <d:collection/>
                        </d:resourcetype>
                      </d:prop>
                      <d:status>HTTP/1.1 200 OK</d:status>
                    </d:propstat>
                  </d:response>
                </d:multistatus>
                """;

        var childCollections = invokeParseMultistatusChildCollections(xml, "https://example.com/caldav.php/");

        assertThat(childCollections).containsExactly(
                "/caldav.php/alice/",
                "/caldav.php/bob/"
        );
    }

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

    /**
     * Helper that calls the package-private parseMultistatusResponse method via reflection
     * to test XML parsing in isolation without needing a real HTTP server.
     * Returns only the calendars from the PropfindResult.
     */
    private java.util.List<CalDavCalendar> invokeParseMultistatus(String xml, String requestUrl) throws Exception {
        var method = CalDavClient.class.getDeclaredMethod("parseMultistatusResponse", String.class, String.class);
        method.setAccessible(true);
        var result = method.invoke(client, xml, requestUrl);
        // PropfindResult is a package-private record, access calendars() via reflection
        var calendarsMethod = result.getClass().getDeclaredMethod("calendars");
        calendarsMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        var calendars = (java.util.List<CalDavCalendar>) calendarsMethod.invoke(result);
        return calendars;
    }

    /**
     * Helper that calls the package-private parseMultistatusResponse method via reflection
     * and returns only the childCollections from the PropfindResult.
     */
    private java.util.List<String> invokeParseMultistatusChildCollections(String xml, String requestUrl) throws Exception {
        var method = CalDavClient.class.getDeclaredMethod("parseMultistatusResponse", String.class, String.class);
        method.setAccessible(true);
        var result = method.invoke(client, xml, requestUrl);
        var childCollectionsMethod = result.getClass().getDeclaredMethod("childCollections");
        childCollectionsMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        var childCollections = (java.util.List<String>) childCollectionsMethod.invoke(result);
        return childCollections;
    }
}
