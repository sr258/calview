/**
 * CalDAV client tests — ported from CalDavClientTest.java (643 lines, 20 tests)
 * and CalDavServiceTest.java (53 lines, 6 tests).
 *
 * Tests cover:
 * - Principal search response parsing (4 tests)
 * - XML building (3 tests)
 * - Free-busy parsing (7 tests, via ical-parser)
 * - iCalendar event parsing (6 tests, via ical-parser)
 * - Validation (6 tests, via service-layer functions)
 */

import { describe, it, expect } from "vitest";
import {
  parsePrincipalSearchResponse,
  parseCalendarQueryResponse,
  buildPrincipalSearchXml,
  escapeXml,
  discoverUsers,
  searchUsers,
} from "./caldav-client.js";
import {
  parseICalendarData,
  parseFreeBusyResponse,
} from "./ical-parser.js";
import { CalDavError } from "../model/types.js";

// =========================================================================
// Principal search response parsing tests
// Ported from CalDavClientTest.java lines 11-136
// =========================================================================

describe("parsePrincipalSearchResponse", () => {
  it("extracts principals from multistatus response", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
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
</multistatus>`;

    const principals = parsePrincipalSearchResponse(xml);

    expect(principals).toHaveLength(3);

    expect(principals[0].displayName).toBe("DAViCal Administrator");
    expect(principals[0].href).toBe("/caldav.php/admin/");

    expect(principals[1].displayName).toBe("Müller, Hans");
    expect(principals[1].href).toBe("/caldav.php/di57zon/");

    expect(principals[2].displayName).toBe("ISB");
    expect(principals[2].href).toBe("/caldav.php/ISB/");
  });

  it("skips non-principal resources", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
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
</multistatus>`;

    const principals = parsePrincipalSearchResponse(xml);

    expect(principals).toHaveLength(0);
  });

  it("uses href for missing displayname", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
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
</multistatus>`;

    const principals = parsePrincipalSearchResponse(xml);

    expect(principals).toHaveLength(1);
    expect(principals[0].displayName).toBe("/caldav.php/unnamed/");
  });

  it("returns empty list for empty multistatus", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">
</multistatus>`;

    const principals = parsePrincipalSearchResponse(xml);

    expect(principals).toHaveLength(0);
  });
});

// =========================================================================
// XML building tests
// Ported from CalDavClientTest.java lines 138-160
// =========================================================================

describe("buildPrincipalSearchXml", () => {
  it("includes the search term", () => {
    const xml = buildPrincipalSearchXml("Müller");

    expect(xml).toContain("<d:match>Müller</d:match>");
    expect(xml).toContain("<d:principal-property-search");
    expect(xml).toContain("<d:displayname/>");
  });

  it("escapes XML special characters", () => {
    const xml = buildPrincipalSearchXml("O'Brien & <Co>");

    expect(xml).toContain(
      "<d:match>O&apos;Brien &amp; &lt;Co&gt;</d:match>"
    );
    expect(xml).not.toContain("O'Brien & <Co>");
  });

  it("handles empty search term", () => {
    const xml = buildPrincipalSearchXml("");

    expect(xml).toContain("<d:match></d:match>");
  });
});

// =========================================================================
// Free-busy parsing tests
// Ported from CalDavClientTest.java lines 162-333
// =========================================================================

describe("parseFreeBusyResponse", () => {
  it("extracts busy periods with different FBTYPE values", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example//NONSGML CalDAV Server//EN
BEGIN:VFREEBUSY
DTSTART:20250210T000000Z
DTEND:20250217T000000Z
FREEBUSY;FBTYPE=BUSY:20250210T140000Z/20250210T150000Z
FREEBUSY;FBTYPE=BUSY-TENTATIVE:20250211T090000Z/20250211T100000Z
FREEBUSY;FBTYPE=BUSY-UNAVAILABLE:20250212T080000Z/20250212T083000Z
END:VFREEBUSY
END:VCALENDAR`;

    const events = parseFreeBusyResponse(ical);

    expect(events).toHaveLength(3);

    // First period: BUSY
    expect(events[0].summary).toBeNull();
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("14:00");
    expect(events[0].endTime).toBe("15:00");
    expect(events[0].status).toBe("BUSY");
    expect(events[0].accessible).toBe(false);

    // Second period: BUSY-TENTATIVE
    expect(events[1].date).toBe("2025-02-11");
    expect(events[1].startTime).toBe("09:00");
    expect(events[1].endTime).toBe("10:00");
    expect(events[1].status).toBe("BUSY-TENTATIVE");
    expect(events[1].accessible).toBe(false);

    // Third period: BUSY-UNAVAILABLE
    expect(events[2].date).toBe("2025-02-12");
    expect(events[2].startTime).toBe("08:00");
    expect(events[2].endTime).toBe("08:30");
    expect(events[2].status).toBe("BUSY-UNAVAILABLE");
    expect(events[2].accessible).toBe(false);
  });

  it("returns empty list when no busy periods", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example//NONSGML CalDAV Server//EN
BEGIN:VFREEBUSY
DTSTART:20250210T000000Z
DTEND:20250217T000000Z
END:VFREEBUSY
END:VCALENDAR`;

    const events = parseFreeBusyResponse(ical);

    expect(events).toHaveLength(0);
  });

  it("handles multiple periods per line", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VFREEBUSY
FREEBUSY;FBTYPE=BUSY:20250210T140000Z/20250210T150000Z,20250210T160000Z/20250210T170000Z
END:VFREEBUSY
END:VCALENDAR`;

    const events = parseFreeBusyResponse(ical);

    expect(events).toHaveLength(2);

    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("14:00");
    expect(events[0].endTime).toBe("15:00");
    expect(events[0].status).toBe("BUSY");

    expect(events[1].date).toBe("2025-02-10");
    expect(events[1].startTime).toBe("16:00");
    expect(events[1].endTime).toBe("17:00");
    expect(events[1].status).toBe("BUSY");
  });

  it("handles duration format", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VFREEBUSY
FREEBUSY;FBTYPE=BUSY:20250210T140000Z/PT1H30M
END:VFREEBUSY
END:VCALENDAR`;

    const events = parseFreeBusyResponse(ical);

    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("14:00");
    expect(events[0].endTime).toBe("15:30");
    expect(events[0].status).toBe("BUSY");
  });

  it("defaults to BUSY when no FBTYPE parameter", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VFREEBUSY
FREEBUSY:20250210T140000Z/20250210T150000Z
END:VFREEBUSY
END:VCALENDAR`;

    const events = parseFreeBusyResponse(ical);

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("BUSY");
  });

  it("returns empty list without VFREEBUSY block", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR`;

    const events = parseFreeBusyResponse(ical);

    expect(events).toHaveLength(0);
  });

  it("handles actual DAViCal server format", () => {
    const ical = `BEGIN:VCALENDAR
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
END:VCALENDAR`;

    const events = parseFreeBusyResponse(ical);

    expect(events).toHaveLength(2);

    expect(events[0].summary).toBeNull();
    expect(events[0].date).toBe("2026-02-10");
    expect(events[0].startTime).toBe("09:30");
    expect(events[0].endTime).toBe("11:00");
    expect(events[0].status).toBe("BUSY");
    expect(events[0].accessible).toBe(false);

    expect(events[1].date).toBe("2026-02-11");
    expect(events[1].startTime).toBe("07:30");
    expect(events[1].endTime).toBe("08:00");
    expect(events[1].status).toBe("BUSY");
    expect(events[1].accessible).toBe(false);
  });
});

// =========================================================================
// iCalendar event parsing tests
// Ported from CalDavClientTest.java lines 339-642
// =========================================================================

describe("parseICalendarData", () => {
  it("parses expanded recurring event into individual occurrences", () => {
    const ical = `BEGIN:VCALENDAR
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
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(2);

    expect(events[0].summary).toBe("Weekly Meeting");
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("10:00");
    expect(events[0].endTime).toBe("11:00");
    expect(events[0].accessible).toBe(true);

    expect(events[1].summary).toBe("Weekly Meeting");
    expect(events[1].date).toBe("2025-02-12");
    expect(events[1].startTime).toBe("10:00");
    expect(events[1].endTime).toBe("11:00");
    expect(events[1].accessible).toBe(true);
  });

  it("parses expanded recurring event with overridden instance", () => {
    const ical = `BEGIN:VCALENDAR
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
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(2);

    // First occurrence: normal time
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("10:00");
    expect(events[0].summary).toBe("Weekly Meeting");

    // Second occurrence: moved to 14:00
    expect(events[1].date).toBe("2025-02-17");
    expect(events[1].startTime).toBe("14:00");
    expect(events[1].endTime).toBe("15:00");
    expect(events[1].summary).toBe("Weekly Meeting (moved)");
  });

  it("parses expanded all-day recurring event", () => {
    const ical = `BEGIN:VCALENDAR
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
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(2);

    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBeNull(); // all-day
    expect(events[0].endTime).toBeNull(); // all-day
    expect(events[0].summary).toBe("Daily Standup");

    expect(events[1].date).toBe("2025-02-11");
    expect(events[1].startTime).toBeNull();
    expect(events[1].endTime).toBeNull();
  });

  it("parses event with DURATION instead of DTEND", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
DURATION:PT1H
SUMMARY:One Hour Meeting
UID:duration-1@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("One Hour Meeting");
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("10:00");
    expect(events[0].endTime).toBe("11:00");
  });

  it("parses event with 90-minute DURATION", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T140000Z
DURATION:PT1H30M
SUMMARY:Long Meeting
UID:duration-2@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(1);
    expect(events[0].startTime).toBe("14:00");
    expect(events[0].endTime).toBe("15:30");
  });

  it("prefers DTEND over DURATION when both present", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T113000Z
DURATION:PT1H
SUMMARY:Conflicting Props
UID:both@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(1);
    // DTEND takes precedence
    expect(events[0].endTime).toBe("11:30");
  });

  it("parses expanded recurring event with DURATION", () => {
    const ical = `BEGIN:VCALENDAR
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
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(2);

    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("09:00");
    expect(events[0].endTime).toBe("10:00");
    expect(events[0].summary).toBe("Weekly Standup");

    expect(events[1].date).toBe("2025-02-17");
    expect(events[1].startTime).toBe("09:00");
    expect(events[1].endTime).toBe("10:00");
  });

  it("parses all-day event without DURATION", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250210
SUMMARY:Holiday
UID:allday@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBeNull();
    expect(events[0].endTime).toBeNull();
  });
});

// =========================================================================
// Calendar query response parsing test
// Ported from CalDavClientTest.java lines 460-508
// =========================================================================

describe("parseCalendarQueryResponse", () => {
  it("parses multistatus XML with expanded recurring event data", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
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
</multistatus>`;

    const events = parseCalendarQueryResponse(xml, true);

    expect(events).toHaveLength(2);

    expect(events[0].summary).toBe("Team Sync");
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("09:00");

    expect(events[1].summary).toBe("Team Sync");
    expect(events[1].date).toBe("2025-02-14");
    expect(events[1].startTime).toBe("09:00");
  });
});

// =========================================================================
// Service-layer validation tests
// Ported from CalDavServiceTest.java (53 lines, 6 tests)
// =========================================================================

describe("validation", () => {
  it("discoverUsers rejects blank URL", async () => {
    await expect(discoverUsers("", "user", "pass")).rejects.toThrow(
      CalDavError
    );
    await expect(discoverUsers("", "user", "pass")).rejects.toThrow(
      /URL must not be empty/
    );
  });

  it("discoverUsers rejects blank username", async () => {
    await expect(
      discoverUsers("https://example.com", "", "pass")
    ).rejects.toThrow(CalDavError);
    await expect(
      discoverUsers("https://example.com", "", "pass")
    ).rejects.toThrow(/Username must not be empty/);
  });

  it("discoverUsers rejects blank password", async () => {
    await expect(
      discoverUsers("https://example.com", "user", "")
    ).rejects.toThrow(CalDavError);
    await expect(
      discoverUsers("https://example.com", "user", "")
    ).rejects.toThrow(/Password must not be empty/);
  });

  it("searchUsers rejects blank search term", async () => {
    await expect(
      searchUsers("https://example.com", "user", "pass", "")
    ).rejects.toThrow(CalDavError);
    await expect(
      searchUsers("https://example.com", "user", "pass", "")
    ).rejects.toThrow(/Search term must not be empty/);
  });

  it("searchUsers rejects blank URL", async () => {
    await expect(
      searchUsers("", "user", "pass", "test")
    ).rejects.toThrow(CalDavError);
    await expect(
      searchUsers("", "user", "pass", "test")
    ).rejects.toThrow(/URL must not be empty/);
  });
});
