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
  expandRRule,
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

  it("filters out deleted occurrences via EXDATE", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
RRULE:FREQ=WEEKLY;COUNT=3
EXDATE:20250217T100000Z
SUMMARY:Weekly Meeting
UID:recurring-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T110000Z
SUMMARY:Weekly Meeting
RECURRENCE-ID:20250210T100000Z
UID:recurring-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250217T100000Z
DTEND:20250217T110000Z
SUMMARY:Weekly Meeting
RECURRENCE-ID:20250217T100000Z
UID:recurring-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250224T100000Z
DTEND:20250224T110000Z
SUMMARY:Weekly Meeting
RECURRENCE-ID:20250224T100000Z
UID:recurring-exdate@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    // The Feb 17 occurrence should be excluded by EXDATE
    expect(events).toHaveLength(3);
    expect(events[0].date).toBe("2025-02-10");
    expect(events[1].date).toBe("2025-02-10");
    expect(events[2].date).toBe("2025-02-24");
    // 2025-02-17 should NOT appear
    const feb17 = events.find((e) => e.date === "2025-02-17");
    expect(feb17).toBeUndefined();
  });

  it("filters out deleted all-day occurrences via EXDATE with VALUE=DATE", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250210
RRULE:FREQ=DAILY;COUNT=3
EXDATE;VALUE=DATE:20250211
SUMMARY:Daily Event
UID:allday-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250210
DTEND;VALUE=DATE:20250211
SUMMARY:Daily Event
RECURRENCE-ID;VALUE=DATE:20250210
UID:allday-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250211
DTEND;VALUE=DATE:20250212
SUMMARY:Daily Event
RECURRENCE-ID;VALUE=DATE:20250211
UID:allday-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250212
DTEND;VALUE=DATE:20250213
SUMMARY:Daily Event
RECURRENCE-ID;VALUE=DATE:20250212
UID:allday-exdate@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    // Feb 11 should be excluded
    const feb11 = events.find((e) => e.date === "2025-02-11");
    expect(feb11).toBeUndefined();
    expect(events.some((e) => e.date === "2025-02-10")).toBe(true);
    expect(events.some((e) => e.date === "2025-02-12")).toBe(true);
  });

  it("filters out multiple EXDATE values (comma-separated)", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:20250217T100000Z,20250303T100000Z
SUMMARY:Weekly
UID:multi-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T110000Z
SUMMARY:Weekly
RECURRENCE-ID:20250210T100000Z
UID:multi-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250217T100000Z
DTEND:20250217T110000Z
SUMMARY:Weekly
RECURRENCE-ID:20250217T100000Z
UID:multi-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250224T100000Z
DTEND:20250224T110000Z
SUMMARY:Weekly
RECURRENCE-ID:20250224T100000Z
UID:multi-exdate@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250303T100000Z
DTEND:20250303T110000Z
SUMMARY:Weekly
RECURRENCE-ID:20250303T100000Z
UID:multi-exdate@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    // Feb 17 and Mar 3 should be excluded
    expect(events.find((e) => e.date === "2025-02-17")).toBeUndefined();
    expect(events.find((e) => e.date === "2025-03-03")).toBeUndefined();
    expect(events.some((e) => e.date === "2025-02-10")).toBe(true);
    expect(events.some((e) => e.date === "2025-02-24")).toBe(true);
  });

  it("filters out cancelled occurrences via STATUS:CANCELLED", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T110000Z
SUMMARY:Weekly Meeting
RECURRENCE-ID:20250210T100000Z
STATUS:CONFIRMED
UID:recurring-cancel@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250217T100000Z
DTEND:20250217T110000Z
SUMMARY:Weekly Meeting
RECURRENCE-ID:20250217T100000Z
STATUS:CANCELLED
UID:recurring-cancel@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250224T100000Z
DTEND:20250224T110000Z
SUMMARY:Weekly Meeting
RECURRENCE-ID:20250224T100000Z
STATUS:CONFIRMED
UID:recurring-cancel@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);

    expect(events).toHaveLength(2);
    expect(events[0].date).toBe("2025-02-10");
    expect(events[1].date).toBe("2025-02-24");
    // Feb 17 (CANCELLED) should NOT appear
    expect(events.find((e) => e.date === "2025-02-17")).toBeUndefined();
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
      /URL darf nicht leer/
    );
  });

  it("discoverUsers rejects blank username", async () => {
    await expect(
      discoverUsers("https://example.com", "", "pass")
    ).rejects.toThrow(CalDavError);
    await expect(
      discoverUsers("https://example.com", "", "pass")
    ).rejects.toThrow(/Benutzername darf nicht leer/);
  });

  it("discoverUsers rejects blank password", async () => {
    await expect(
      discoverUsers("https://example.com", "user", "")
    ).rejects.toThrow(CalDavError);
    await expect(
      discoverUsers("https://example.com", "user", "")
    ).rejects.toThrow(/Passwort darf nicht leer/);
  });

  it("searchUsers rejects blank search term", async () => {
    await expect(
      searchUsers("https://example.com", "user", "pass", "")
    ).rejects.toThrow(CalDavError);
    await expect(
      searchUsers("https://example.com", "user", "pass", "")
    ).rejects.toThrow(/Suchbegriff darf nicht leer/);
  });

  it("searchUsers rejects blank URL", async () => {
    await expect(
      searchUsers("", "user", "pass", "test")
    ).rejects.toThrow(CalDavError);
    await expect(
      searchUsers("", "user", "pass", "test")
    ).rejects.toThrow(/URL darf nicht leer/);
  });
});

// =========================================================================
// RRULE expansion tests
// =========================================================================

describe("expandRRule", () => {
  it("expands FREQ=DAILY within range", () => {
    const results = expandRRule(
      "20250210T100000Z",
      "FREQ=DAILY",
      new Set(),
      "2025-02-10",
      "2025-02-14"
    );
    expect(results).toEqual([
      "20250210T100000Z",
      "20250211T100000Z",
      "20250212T100000Z",
      "20250213T100000Z",
    ]);
  });

  it("expands FREQ=DAILY with COUNT limit", () => {
    const results = expandRRule(
      "20250210T100000Z",
      "FREQ=DAILY;COUNT=3",
      new Set(),
      "2025-02-10",
      "2025-02-17"
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toBe("20250210T100000Z");
    expect(results[2]).toBe("20250212T100000Z");
  });

  it("expands FREQ=DAILY with UNTIL limit", () => {
    const results = expandRRule(
      "20250210T100000Z",
      "FREQ=DAILY;UNTIL=20250212T235959Z",
      new Set(),
      "2025-02-10",
      "2025-02-17"
    );
    expect(results).toHaveLength(3);
    expect(results[2]).toBe("20250212T100000Z");
  });

  it("expands FREQ=DAILY with INTERVAL=2", () => {
    const results = expandRRule(
      "20250210T100000Z",
      "FREQ=DAILY;INTERVAL=2",
      new Set(),
      "2025-02-10",
      "2025-02-17"
    );
    // Feb 10, 12, 14, 16
    expect(results).toEqual([
      "20250210T100000Z",
      "20250212T100000Z",
      "20250214T100000Z",
      "20250216T100000Z",
    ]);
  });

  it("excludes EXDATE occurrences", () => {
    const exdates = new Set(["20250211T100000"]);
    const results = expandRRule(
      "20250210T100000Z",
      "FREQ=DAILY;COUNT=3",
      exdates,
      "2025-02-10",
      "2025-02-17"
    );
    // Feb 10, (11 excluded), 12
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("20250210T100000Z");
    expect(results[1]).toBe("20250212T100000Z");
  });

  it("excludes EXDATE by date-only match", () => {
    const exdates = new Set(["20250211"]);
    const results = expandRRule(
      "20250210T100000Z",
      "FREQ=DAILY;COUNT=3",
      exdates,
      "2025-02-10",
      "2025-02-17"
    );
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.includes("20250211"))).toBeUndefined();
  });

  it("expands FREQ=WEEKLY within range", () => {
    const results = expandRRule(
      "20250210T100000Z", // Monday
      "FREQ=WEEKLY",
      new Set(),
      "2025-02-10",
      "2025-02-24"
    );
    expect(results).toEqual([
      "20250210T100000Z",
      "20250217T100000Z",
    ]);
  });

  it("expands FREQ=WEEKLY with BYDAY", () => {
    const results = expandRRule(
      "20250210T100000Z", // Monday
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      new Set(),
      "2025-02-10",
      "2025-02-17"
    );
    // Week of Feb 10: MO=10, WE=12, FR=14
    expect(results).toHaveLength(3);
    expect(results[0]).toBe("20250210T100000Z");
    expect(results[1]).toBe("20250212T100000Z");
    expect(results[2]).toBe("20250214T100000Z");
  });

  it("expands FREQ=WEEKLY;BYDAY with COUNT spanning weeks", () => {
    const results = expandRRule(
      "20250210T100000Z",
      "FREQ=WEEKLY;BYDAY=MO,FR;COUNT=5",
      new Set(),
      "2025-02-10",
      "2025-02-28"
    );
    // MO Feb 10, FR Feb 14, MO Feb 17, FR Feb 21, MO Feb 24
    expect(results).toHaveLength(5);
    expect(results[0]).toBe("20250210T100000Z");
    expect(results[1]).toBe("20250214T100000Z");
    expect(results[2]).toBe("20250217T100000Z");
    expect(results[3]).toBe("20250221T100000Z");
    expect(results[4]).toBe("20250224T100000Z");
  });

  it("expands FREQ=MONTHLY", () => {
    const results = expandRRule(
      "20250110T100000Z",
      "FREQ=MONTHLY;COUNT=3",
      new Set(),
      "2025-01-01",
      "2025-04-01"
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toBe("20250110T100000Z");
    expect(results[1]).toBe("20250210T100000Z");
    expect(results[2]).toBe("20250310T100000Z");
  });

  it("returns only occurrences within range (master before range)", () => {
    const results = expandRRule(
      "20250201T100000Z",
      "FREQ=DAILY",
      new Set(),
      "2025-02-10",
      "2025-02-13"
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toBe("20250210T100000Z");
    expect(results[1]).toBe("20250211T100000Z");
    expect(results[2]).toBe("20250212T100000Z");
  });

  it("handles date-only (all-day) events", () => {
    const results = expandRRule(
      "20250210",
      "FREQ=DAILY;COUNT=3",
      new Set(),
      "2025-02-10",
      "2025-02-17"
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toBe("20250210");
    expect(results[1]).toBe("20250211");
    expect(results[2]).toBe("20250212");
  });
});

// =========================================================================
// RRULE expansion integration via parseICalendarData
// =========================================================================

describe("parseICalendarData with RRULE expansion", () => {
  it("expands a daily recurring event within range", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T110000Z
SUMMARY:Daily Standup
RRULE:FREQ=DAILY;COUNT=5
UID:daily@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true, "2025-02-10", "2025-02-17");
    expect(events).toHaveLength(5);
    expect(events[0].date).toBe("2025-02-10");
    expect(events[0].startTime).toBe("10:00");
    expect(events[0].endTime).toBe("11:00");
    expect(events[4].date).toBe("2025-02-14");
  });

  it("excludes EXDATE from recurring expansion", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T110000Z
SUMMARY:Daily Standup
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20250212T100000Z
UID:daily@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true, "2025-02-10", "2025-02-17");
    expect(events).toHaveLength(4);
    expect(events.find((e) => e.date === "2025-02-12")).toBeUndefined();
  });

  it("applies RECURRENCE-ID override to expanded event", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T110000Z
SUMMARY:Weekly Meeting
RRULE:FREQ=WEEKLY;COUNT=3
UID:weekly@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250217T140000Z
DTEND:20250217T150000Z
SUMMARY:Weekly Meeting (Rescheduled)
RECURRENCE-ID:20250217T100000Z
UID:weekly@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true, "2025-02-10", "2025-02-28");
    // Feb 10 (master), Feb 17 override replaces master occurrence, Feb 24 (master)
    expect(events).toHaveLength(3);
    // The override should have the rescheduled time
    const feb17 = events.find((e) => e.date === "2025-02-17");
    expect(feb17).toBeDefined();
    expect(feb17!.startTime).toBe("14:00");
    expect(feb17!.summary).toBe("Weekly Meeting (Rescheduled)");
  });

  it("without range params, treats master as single event (legacy)", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250210T100000Z
DTEND:20250210T110000Z
SUMMARY:Recurring
RRULE:FREQ=DAILY;COUNT=100
UID:rec@example.com
END:VEVENT
END:VCALENDAR`;

    const events = parseICalendarData(ical, true);
    // Without range, master is treated as single event
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2025-02-10");
  });
});
