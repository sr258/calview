CalView SPA Rewrite — Full Implementation Plan
---
Overview
Rewrite the CalView appointment planner from a Java/Spring/Vaadin server-side app to a browser-only SPA packaged as a Tauri v2 desktop application. The new app will be created in calview/app/ while the old Java code remains at the repo root as reference.
---
Tech Stack
| Layer | Choice |
|-------|--------|
| UI Framework | Preact + JSX/TSX |
| Reactivity | Preact Signals |
| Build Tool | Vite + @preact/preset-vite |
| Language | TypeScript (strict mode) |
| Styling | Plain CSS (ported from current styles.css) |
| HTTP (production) | @tauri-apps/plugin-http |
| HTTP (development) | fetch() via Vite dev server proxy |
| XML Parsing | txml |
| iCal Parsing | ical.js |
| Desktop Packaging | Tauri v2 |
| Testing | Vitest |
| Package Manager | npm |
| CI | GitLab CI, Linux runner, cross-compile Windows .exe via cargo-xwin |
---
Dev Flow
- Code on Linux terminal server via VS Code Remote-SSH
- Run npm run dev → Vite dev server on Linux (VS Code auto-forwards the port)
- Test in Windows browser at http://localhost:5173
- CalDAV in dev → Vite proxy forwards /api/caldav to the real CalDAV server (no CORS issue)
- CalDAV in prod → Tauri HTTP plugin makes requests from Rust side (bypasses CORS)
- Build .exe → GitLab CI cross-compiles on Linux runner using cargo-xwin
---
Target Project Structure
calview/
├── app/                              # New SPA project root
│   ├── src/
│   │   ├── main.tsx                  # Entry point, renders <App />
│   │   ├── app.tsx                   # Root component, login-on-first-load logic
│   │   ├── components/
│   │   │   ├── login-dialog.tsx      # Modal login form (URL, username, password)
│   │   │   ├── toolbar.tsx           # Top bar: title, connection status, connect button
│   │   │   ├── user-search.tsx       # Search input + dropdown results list
│   │   │   ├── week-navigator.tsx    # Prev/Next/Today buttons + week label
│   │   │   └── schedule-grid.tsx     # The main weekly schedule table
│   │   ├── services/
│   │   │   ├── http.ts              # HTTP abstraction (Tauri plugin vs fetch, selected at runtime)
│   │   │   ├── caldav-client.ts     # CalDAV protocol: XML building, REPORT requests, response parsing
│   │   │   └── ical-parser.ts       # iCalendar text → CalDavEvent[] (using ical.js)
│   │   ├── model/
│   │   │   ├── types.ts             # CalDavUser, CalDavEvent, SlotInfo, ScheduleRow
│   │   │   └── schedule.ts          # Pure functions: computeUserSlots, computeAllFreeSlots, time slot generation
│   │   ├── state/
│   │   │   └── app-state.ts         # Preact Signals: connection, credentials, selectedUsers, userEvents, currentWeekStart
│   │   └── styles/
│   │       ├── index.css            # Global resets, layout
│   │       └── schedule.css         # Ported from current styles.css (slot colors, grid layout, week nav)
│   ├── index.html                   # Vite entry HTML
│   ├── vite.config.ts               # Preact preset, dev proxy for /api/caldav
│   ├── tsconfig.json                # Strict TS, JSX for Preact
│   ├── package.json
│   └── package-lock.json
│   ├── src-tauri/                    # Tauri v2 Rust backend
│   │   ├── src/
│   │   │   └── lib.rs               # Minimal: register HTTP plugin
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json          # App name, window config, HTTP plugin permissions
│   │   ├── capabilities/
│   │   │   └── default.json         # Tauri v2 capability: allow HTTP to CalDAV servers
│   │   └── icons/                   # App icons
│   ├── src-tauri/gen/               # Tauri-generated (gitignored)
│   └── .gitlab-ci.yml               # CI pipeline for cross-compilation
├── src/                              # OLD Java code (kept as reference, deleted later)
├── pom.xml                           # OLD Maven build (deleted later)
└── AGENTS.md                         # Updated for new project
---
Phases & Tasks
Phase 1 — Project Scaffolding
Goal: Empty Preact + Vite + Tauri project that builds and shows "Hello World."
| # | Task | Details |
|---|------|---------|
| 1.1 | Create app/ directory | — |
| 1.2 | Initialize npm project | npm init, set "type": "module" |
| 1.3 | Install Preact + Vite deps | preact, @preact/preset-vite, vite, typescript |
| 1.4 | Configure tsconfig.json | strict: true, jsxImportSource: "preact", target: "ES2022", module: "ESNext" |
| 1.5 | Configure vite.config.ts | Preact preset, dev server proxy: /api/caldav → https://isb-kalender.zit.mwn.de/caldav.php (with changeOrigin: true, secure: false for self-signed certs) |
| 1.6 | Create index.html | Minimal HTML with <div id="app"> and <script type="module" src="/src/main.tsx"> |
| 1.7 | Create src/main.tsx | Renders <App /> into #app |
| 1.8 | Create src/app.tsx | Placeholder "Hello CalView" component |
| 1.9 | Initialize Tauri v2 | npm install @tauri-apps/cli, npx tauri init inside app/ — configure src-tauri/tauri.conf.json with app name "CalView", dev server URL, build commands |
| 1.10 | Install Tauri HTTP plugin | npm install @tauri-apps/plugin-http, add plugin to src-tauri/Cargo.toml and register in lib.rs |
| 1.11 | Configure Tauri capabilities | src-tauri/capabilities/default.json: allow http:default with scope for https://* (CalDAV servers) |
| 1.12 | Verify | npm run dev serves the page; npm run tauri dev opens a Tauri window (on a machine with GUI) |
---
Phase 2 — HTTP Abstraction Layer
Goal: A single httpRequest() function that works in both dev (Vite proxy + fetch) and prod (Tauri HTTP plugin).
| # | Task | Details |
|---|------|---------|
| 2.1 | Create src/services/http.ts | Export an httpRequest(options) function |
| 2.2 | Runtime detection | Check window.__TAURI_INTERNALS__ to detect Tauri environment |
| 2.3 | Tauri path | Import fetch from @tauri-apps/plugin-http, send request directly to CalDAV server URL (no CORS restriction) |
| 2.4 | Browser/dev path | Use native fetch(), rewrite CalDAV URLs to go through Vite's /api/caldav proxy prefix |
| 2.5 | Shared interface | HttpRequestOptions { url, method, headers, body } → HttpResponse { status, body, headers } |
| 2.6 | Basic Auth helper | buildBasicAuthHeader(username, password) → "Basic " + btoa(...) |
Mapping from Java code:
- CalDavClient.sendReport() → httpRequest({ method: "REPORT", ... })
- CalDavClient.sendCalendarReport() → same pattern
- CalDavClient.sendFreeBusyReport() → same pattern
- The trustAllCertificates SSL bypass is not needed — Tauri's Rust HTTP client handles SSL normally, and the Vite proxy has secure: false
---
Phase 3 — Data Model (TypeScript Types)
Goal: Port all Java records/types to TypeScript interfaces.
| # | Task | Source Java | Target TypeScript |
|---|------|-------------|-------------------|
| 3.1 | CalDavUser | CalDavUser.java (2 fields) | interface CalDavUser { displayName: string; href: string; } |
| 3.2 | CalDavEvent | CalDavEvent.java (6 fields) | interface CalDavEvent { summary: string \| null; date: string; startTime: string \| null; endTime: string \| null; status: string; accessible: boolean; } — dates as ISO strings "2025-02-10", times as "HH:mm" strings |
| 3.3 | SlotInfo | CalDavView.SlotInfo | interface SlotInfo { cssClass: string; label: string \| null; tooltip: string \| null; busy: boolean; } |
| 3.4 | ScheduleRow | CalDavView.ScheduleRow | interface ScheduleRow { user: CalDavUser \| null; slots: Record<string, SlotInfo>; } |
| 3.5 | CalDavError | CalDavException.java | class CalDavError extends Error (simple custom error class) |
| 3.6 | ConnectionInfo | implicit in View fields | interface ConnectionInfo { url: string; username: string; password: string; } |
Design note: Using plain date/time strings instead of Date objects avoids timezone pitfalls. All CalDAV times are UTC; we parse them to local display strings. A parseTime() / parseDate() helper set will handle conversions.
---
Phase 4 — CalDAV Client (Business Logic)
Goal: Port CalDavClient.java (881 lines) and CalDavService.java (130 lines) to TypeScript.
4A — XML Building
| # | Task | Source (CalDavClient.java) | Target |
|---|------|---------------------------|--------|
| 4A.1 | Principal search XML (wildcard) | PRINCIPAL_SEARCH_XML (lines 73-87) | Constant string in caldav-client.ts |
| 4A.2 | Principal search XML (by name) | PRINCIPAL_SEARCH_BY_NAME_XML_TEMPLATE + buildPrincipalSearchXml() (lines 95-109, 179-182) | Function: buildPrincipalSearchXml(searchTerm: string): string |
| 4A.3 | Calendar query XML | CALENDAR_QUERY_XML_TEMPLATE (lines 271-289) | Constant template + string replacement |
| 4A.4 | Free-busy query XML | FREE_BUSY_QUERY_XML_TEMPLATE (lines 297-302) | Constant template + string replacement |
| 4A.5 | XML escaping | escapeXml() (lines 188-195) | escapeXml(input: string): string — same 5 replacements |
| 4A.6 | URL normalization | normalizeUrl() (lines 840-849) | normalizeUrl(url: string): string |
| 4A.7 | href resolution | resolveHref() (lines 830-838) | resolveHref(baseUrl: string, href: string): string — use new URL(href, baseUrl) |
4B — XML Response Parsing
Using txml (lightweight XML parser that returns a JSON-like tree).
| # | Task | Source (CalDavClient.java) | Details |
|---|------|---------------------------|---------|
| 4B.1 | Install txml | — | npm install txml |
| 4B.2 | Parse principal search response | parsePrincipalSearchResponse() (lines 695-731) | Parse multistatus XML, extract <href>, <displayname>, check for <principal/> in <resourcetype>, check <status> contains "200" |
| 4B.3 | Helper: isSuccessResponse() | lines 789-798 | Check <propstat> → <status> contains "200" |
| 4B.4 | Helper: isPrincipalResource() | lines 733-751 | Check <resourcetype> contains <principal/> |
| 4B.5 | Helper: getPropertyText() | lines 801-816 | Navigate <propstat> → <prop> → find element by tag name |
| 4B.6 | Parse calendar query response | parseCalendarQueryResponse() (lines 389-418) | Parse multistatus XML, extract <calendar-data> text, pass to iCal parser |
Note: The txml parser returns arrays of nodes. We'll write small helper functions to traverse the tree and find elements by tag name (namespace-unaware — txml doesn't handle namespaces natively, but CalDAV responses use prefixed tag names like d:href or unprefixed href depending on server). We'll match by local name, stripping any prefix.
4C — iCalendar Parsing
| # | Task | Source (CalDavClient.java) | Details |
|---|------|---------------------------|---------|
| 4C.1 | Install ical.js | — | npm install ical.js, npm install -D @types/ical.js (or hand-write minimal types if no @types available) |
| 4C.2 | Parse VEVENT data | parseICalendarData() (lines 436-492) | Use ical.js ICAL.parse() + ICAL.Component to iterate VEVENTs, extract SUMMARY, DTSTART, DTEND, DURATION, CLASS |
| 4C.3 | Handle DURATION fallback | lines 467-469 | If no DTEND, compute from DTSTART + DURATION. ical.js has ICAL.Duration support built in. |
| 4C.4 | Handle all-day events | lines 463-464 | DATE-only DTSTART → startTime = null, endTime = null |
| 4C.5 | Handle accessible vs restricted | lines 479-486 | If accessible, include summary; otherwise set summary = null |
| 4C.6 | Parse free-busy response | parseFreeBusyResponse() (lines 526-605) | Use ical.js ICAL.Component to find VFREEBUSY, iterate FREEBUSY properties, extract periods (start/end or start/duration), extract FBTYPE parameter |
Alternative approach for iCal parsing: The current Java code uses manual regex parsing. We could port that directly to TypeScript (regex patterns are the same) instead of introducing ical.js. This would:
- Avoid a dependency (~50KB)
- Be a more direct 1:1 port
- Keep the parsing logic simple and understandable
Decision: Start with manual regex port (matches existing Java logic exactly), consider ical.js later if edge cases arise. This means:
- Port parseICalendarData() as regex-based TS function
- Port parseFreeBusyResponse() as regex-based TS function  
- Port extractICalProperty(), parseICalDate(), parseICalTime(), parseDurationEndTime() as helpers
- Drop ical.js from the dependency list
4D — HTTP Request Functions
| # | Task | Source | Details |
|---|------|--------|---------|
| 4D.1 | sendReport() | CalDavClient.sendReport() (lines 753-787) | Use httpRequest() with method REPORT, Depth 0, Basic auth. Handle status 207/401/403/404. |
| 4D.2 | sendCalendarReport() | CalDavClient.sendCalendarReport() (lines 304-338) | Same but Depth 1. Handle 207/401/403/404. |
| 4D.3 | sendFreeBusyReport() | CalDavClient.sendFreeBusyReport() (lines 347-383) | Depth 1, expect status 200 (not 207). |
4E — Service Layer
| # | Task | Source (CalDavService.java) | Details |
|---|------|---------------------------|---------|
| 4E.1 | validateInputs() | lines 118-128 | Throw CalDavError for blank url/username/password |
| 4E.2 | searchUsers() | lines 61-72 | Validate → buildPrincipalSearchXml() → sendReport() → parsePrincipalSearchResponse() → return CalDavUser[] |
| 4E.3 | fetchWeekEvents() | lines 89-116 | Validate → build calendar URL from userHref + "/calendar/" → try sendCalendarReport() → if 403 fallback to sendFreeBusyReport() → parse → sort by date then time |
| 4E.4 | Event sorting | lines 97-112 | Sort: by date ascending, then by startTime ascending (null/all-day first) |
---
Phase 5 — Schedule Computation (Pure Functions)
Goal: Port the slot-mapping and "all free" logic from CalDavView.java to pure functions in src/model/schedule.ts.
| # | Task | Source (CalDavView.java) | Details |
|---|------|--------------------------|---------|
| 5.1 | Constants | lines 69-84 | SCHEDULE_START = "07:00", SCHEDULE_END = "19:00", SLOT_MINUTES = 30, WEEKDAYS = [1..5], DAY_SHORT_NAMES |
| 5.2 | generateTimeSlots() | lines 139-148 | Return array of time strings: ["07:00", "07:30", ..., "18:30"] |
| 5.3 | generateSlotKeys() | lines 144-148 | Return array: ["0-07:00", "0-07:30", ..., "4-18:30"] |
| 5.4 | computeUserSlots() | lines 538-576 | For each day × timeslot: find overlapping events → determine CSS class, label, tooltip, busy flag |
| 5.5 | filterEventsForDay() | lines 604-608 | Filter events by date match |
| 5.6 | findOverlappingEvents() | lines 616-628 | All-day events overlap all slots; timed events use start < slotEnd && end > slotStart |
| 5.7 | selectPrimaryEvent() | lines 635-645 | Priority: BUSY-UNAVAILABLE(3) > BUSY(2) > BUSY-TENTATIVE(1). Prefer accessible. |
| 5.8 | eventPriority() | lines 647-654 | Switch on status string
| 5.5 | filterEventsForDay() | lines 604-608 | Filter events by date match |
| 5.6 | findOverlappingEvents() | lines 616-628 | All-day events overlap all slots; timed events use start < slotEnd && end > slotStart |
| 5.7 | selectPrimaryEvent() | lines 635-645 | Priority: BUSY-UNAVAILABLE(3) > BUSY(2) > BUSY-TENTATIVE(1). Prefer accessible. |
| 5.8 | eventPriority() | lines 647-654 | Switch on status string → numeric priority |
| 5.9 | getCssClassForEvent() | lines 659-670 | accessible → "slot-busy", else by status: tentative/unavailable/fb |
| 5.10 | getSlotLabel() | lines 676-682 | Accessible + has summary → truncate to 7 chars + "…" |
| 5.11 | buildTooltip() | lines 689-716 | List all overlapping events with name and time range |
| 5.12 | computeAllFreeSlots() | lines 581-599 | For each slot key: if no user row has busy=true → "slot-all-free", else "slot-not-all-free" |
| 5.13 | buildScheduleRows() | lines 518-533 | One ScheduleRow per user + one "All Free" summary row at the end |
---
Phase 6 — Application State (Preact Signals)
Goal: Centralized reactive state in src/state/app-state.ts.
| # | Signal | Type | Initial | Purpose |
|---|--------|------|---------|---------|
| 6.1 | connection | Signal<ConnectionInfo \| null> | null | Stores URL + credentials after successful login |
| 6.2 | connected | Signal<boolean> | false | Whether login was successful |
| 6.3 | selectedUsers | Signal<CalDavUser[]> | [] | Ordered list of users added to the grid |
| 6.4 | userEvents | Signal<Map<string, CalDavEvent[]>> | empty Map | Keyed by user.href, events for current week |
| 6.5 | failedUsers | Signal<Set<string>> | empty Set | user.href values for users whose fetch failed |
| 6.6 | currentWeekStart | Signal<string> | Monday of current week (ISO date) | The displayed week |
| 6.7 | loading | Signal<boolean> | false | Show spinner during fetch operations |
| 6.8 | showLoginDialog | Signal<boolean> | true | Controls login dialog visibility |
Also export action functions that mutate state:
- connect(url, username, password) — validate, test search, set connection + connected
- addUser(user) — append to selectedUsers, fetch events, update userEvents
- removeUser(user) — remove from selectedUsers/userEvents/failedUsers
- navigateWeek(offset) — update currentWeekStart, re-fetch all events
- navigateToToday() — set currentWeekStart to current Monday, re-fetch
- refreshAllEvents() — clear and re-fetch events for all selected users
- disconnect() — clear all state
---
Phase 7 — UI Components
Goal: Build all Preact components. Each component reads from signals and calls action functions.
7.1 — src/app.tsx (Root Component)
- Renders: <Toolbar>, <LoginDialog>, main content area with <UserSearch>, <WeekNavigator>, and either empty message or <ScheduleGrid>
- On mount: if !connected, show login dialog
7.2 — src/components/login-dialog.tsx
Port from: CalDavView.openLoginDialog() (lines 726-808)
- Modal overlay (pure HTML/CSS, no library)
- Fields: URL (pre-filled with default), Username, Password
- Buttons: Connect, Cancel (Cancel only visible if already connected)
- On Connect: call connect() action, show error/success notification
- Auto-focus logic: first empty field gets focus
- "Connecting..." state on the button while request is in flight
7.3 — src/components/toolbar.tsx
Port from: CalDavView constructor toolbar section (lines 153-164)
- Left: "Planner" title
- Right: connection status text ("Not connected" / "Connected as {username}") + Connect/Reconnect button
- Connection status color: gray when disconnected, green when connected
7.4 — src/components/user-search.tsx
Port from: CalDavView.createUserSearchBox() (lines 224-255)
- Text input with placeholder "Type at least 2 characters to search..."
- Debounced search (300ms) — call searchUsers() when input length >= 2
- Dropdown list of results (filtered to exclude already-selected users)
- On select: call addUser(), clear input
- Disabled when not connected
- Pure HTML <input> + positioned <ul> dropdown (no library needed)
7.5 — src/components/week-navigator.tsx
Port from: CalDavView week navigation (lines 177-199, 295-318)
- Previous week button (<), Today button, week label ("Feb 10 - Feb 14, 2025"), Next week button (>)
- Disabled when no users selected
- Buttons call navigateWeek(-1), navigateToToday(), navigateWeek(1)
7.6 — src/components/schedule-grid.tsx (MOST COMPLEX)
Port from: CalDavView.rebuildScheduleGrid() (lines 361-446) and slot renderer (lines 453-469)
Implementation as an HTML <table>:
<table>
  <thead>
    <tr>  ← Day header row: <th colspan="24">Mon Feb 10</th> × 5 days
    <tr>  ← Time header row: <th>7:00</th><th></th><th>8:00</th>... per day
  </thead>
  <tbody>
    <tr>  ← One per user: <td>Name [X]</td> + 120 slot <td>s
    <tr>  ← "All Free" summary row
  </tbody>
</table>
- First column is frozen (CSS position: sticky; left: 0)
- Each slot <td> gets the CSS class from SlotInfo.cssClass and title attribute from SlotInfo.tooltip
- Slot label text shown inside the cell for accessible events
- User name cell: name text + remove button (X). Warning icon if user is in failedUsers.
- "All Free" row: user === null, bold label
- Table wrapped in a horizontally scrollable container
- 120 slot columns at 40px each = 4800px wide + user column
Performance consideration: 120 columns × ~10 rows = ~1200 cells. No virtualization needed — this is well within browser rendering capability for a plain <table>.
---
Phase 8 — Styling
Goal: Port styles.css (116 lines) and add base styles.
| # | Task | Details |
|---|------|---------|
| 8.1 | src/styles/index.css | CSS reset, full-height layout, font stack (system fonts), CSS custom properties for colors (keep Lumo-like variable names or define our own) |
| 8.2 | src/styles/schedule.css | Direct port of current styles.css. Replace Vaadin-specific selectors (vaadin-grid-cell-content, ::part(day-separator)) with plain CSS selectors targeting our <table> structure. All .slot-* classes remain unchanged. |
CSS variable mapping (Vaadin Lumo → custom):
| Lumo Variable | New Variable | Default Value |
|---------------|-------------|---------------|
| --lumo-primary-color | --cv-primary | #1676f3 |
| --lumo-primary-color-10pct | --cv-primary-10 | rgba(22,118,243,0.1) |
| --lumo-primary-text-color | --cv-primary-text | #1565c0 |
| --lumo-warning-color | --cv-warning | #f0a030 |
| --lumo-warning-text-color | --cv-warning-text | #8c6900 |
| --lumo-error-color | --cv-error | #e53935 |
| --lumo-error-color-10pct | --cv-error-10 | rgba(229,57,53,0.1) |
| --lumo-error-text-color | --cv-error-text | #c62828 |
| --lumo-success-color-10pct | --cv-success-10 | rgba(46,174,52,0.1) |
| --lumo-success-text-color | --cv-success-text | #2e7d32 |
| --lumo-contrast-5pct | --cv-contrast-5 | rgba(0,0,0,0.05) |
| --lumo-contrast-10pct | --cv-contrast-10 | rgba(0,0,0,0.1) |
| --lumo-contrast-20pct | --cv-contrast-20 | rgba(0,0,0,0.2) |
| --lumo-secondary-text-color | --cv-text-secondary | #6b7280 |
| --lumo-font-size-* | --cv-font-* | Standard sizes |
---
Phase 9 — Notifications
The current app uses Vaadin Notification toasts. We need a simple toast notification system.
| # | Task | Details |
|---|------|---------|
| 9.1 | Create src/components/notifications.tsx | Simple toast container positioned at bottom-center |
| 9.2 | Signal-based notification state | Signal<Notification[]> with { id, message, variant, duration } |
| 9.3 | showNotification() helper | Adds to signal, auto-removes after duration ms |
| 9.4 | Variants | success (green), warning (yellow), error (red) — matching current usage |
---
Phase 10 — Configuration
| # | Task | Details |
|---|------|---------|
| 10.1 | Default CalDAV URL | Hardcoded constant: "https://isb-kalender.zit.mwn.de/caldav.php" (was in application.properties) |
| 10.2 | Vite dev proxy config | In vite.config.ts: proxy /api/caldav → target CalDAV server |
| 10.3 | Tauri config | tauri.conf.json: window title "CalView", default size 1200×800, HTTP plugin permissions |
---
Phase 11 — Tests (Vitest)
Goal: Port CalDavClientTest.java (16 tests, 644 lines) and CalDavServiceTest.java (6 tests, 54 lines).
| # | Test File | Tests to Port | Source |
|---|-----------|--------------|--------|
| 11.1 | caldav-client.test.ts — Principal parsing | 4 tests: extract principals, skip non-principals, use href for missing displayname, empty response | CalDavClientTest.java lines 11-136 |
| 11.2 | caldav-client.test.ts — XML building | 3 tests: includes search term, escapes XML specials, handles empty term | lines 139-160 |
| 11.3 | caldav-client.test.ts — Free-busy parsing | 6 tests: extract busy periods, no busy periods, multiple periods per line, duration format, default BUSY, no VFREEBUSY block, DAViCal actual format | lines 163-333 |
| 11.4 | caldav-client.test.ts — iCal event parsing | 5 tests: expanded recurring, overridden instance, all-day recurring, calendar-query response, DURATION handling (4 sub-tests) | lines 339-642 |
| 11.5 | caldav-service.test.ts — Validation | 6 tests: blank URL, blank username, blank password, blank search term, null search term, blank URL for search | CalDavServiceTest.java lines 13-53 |
| 11.6 | schedule.test.ts — Schedule computation | NEW tests (no Java equivalent — logic was embedded in the View): computeUserSlots, computeAllFreeSlots, findOverlappingEvents, selectPrimaryEvent, getCssClassForEvent, getSlotLabel, buildTooltip |
Install: npm install -D vitest
---
Phase 12 — GitLab CI
Goal: .gitlab-ci.yml that cross-compiles a Windows .exe on a Linux runner.
stages:
  - build
build-windows:
  stage: build
  image: rust:latest   # or a custom image with Node + Rust + cargo-xwin
  before_script:
    - apt-get update && apt-get install -y nodejs npm libwebkit2gtk-4.1-dev  # Linux deps for Tauri CLI
    - cargo install cargo-xwin
    - rustup target add x86_64-pc-windows-msvc
    - cd app && npm ci
  script:
    - npx tauri build --target x86_64-pc-windows-msvc --bundles nsis
  artifacts:
    paths:
      - app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe
    expire_in: 30 days
Notes:
- cargo-xwin automatically downloads MSVC CRT headers — no Windows SDK needed
- The CI image may need to be customized for faster builds (pre-installed Rust + Node)
- First build will be slow (compiling Rust deps); subsequent builds use CI cache
---
Phase 13 — Cleanup & Finalization
| # | Task | Details |
|---|------|---------|
| 13.1 | Verify all features work | Connect, search, add users, week navigation, slot colors, tooltips, remove users, "all free" row |
| 13.2 | Verify all tests pass | npm test in app/ |
| 13.3 | Update .gitignore | Add app/node_modules/, app/dist/, app/src-tauri/target/, app/src-tauri/gen/ |
| 13.4 | Delete old Java code | Remove src/, pom.xml, mvnw, mvnw.cmd, .mvn/, Dockerfile, src/main/frontend/, src/main/resources/ — everything from the old Vaadin/Spring project |
| 13.5 | Move app/ to root | Move all contents of app/ to the repo root |
| 13.6 | Update AGENTS.md | Rewrite to reflect the new TypeScript/Preact/Tauri project structure, build commands, architecture |
| 13.7 | Final cleanup | Remove any leftover files, verify npm run dev, npm test, and npm run build all work |
---
File-by-File Porting Reference
This maps every significant piece of Java logic to its TypeScript destination, so we don't miss anything across sessions.
CalDavClient.java (881 lines) → src/services/caldav-client.ts + src/services/ical-parser.ts
| Java Lines | Method/Constant | Target File | Target Function |
|-----------|----------------|-------------|-----------------|
| 53-55 | DAV_NS, CALDAV_NS | caldav-client.ts | Constants (used only for documentation; txml doesn't do namespace-aware parsing) |
| 57-58 | CONNECT_TIMEOUT, REQUEST_TIMEOUT | http.ts | Timeout constants passed to fetch/Tauri HTTP |
| 73-87 | PRINCIPAL_SEARCH_XML | caldav-client.ts | Constant string |
| 95-109 | PRINCIPAL_SEARCH_BY_NAME_XML_TEMPLATE | caldav-client.ts | Constant string |
| 121-136 | discoverUsers() | caldav-client.ts | discoverUsers() |
| 153-170 | searchUsers() | caldav-client.ts | searchUsers() |
| 179-182 | buildPrincipalSearchXml() | caldav-client.ts | buildPrincipalSearchXml() |
| 188-195 | escapeXml() | caldav-client.ts | escapeXml() |
| 218-256 | fetchWeekEvents() | caldav-client.ts | fetchWeekEvents() |
| 258 | ICAL_DATE_FORMATTER | ical-parser.ts | formatICalDate() — simple yyyyMMdd formatting |
| 271-289 | CALENDAR_QUERY_XML_TEMPLATE | caldav-client.ts | Constant string |
| 297-302 | FREE_BUSY_QUERY_XML_TEMPLATE | caldav-client.ts | Constant string |
| 304-338 | sendCalendarReport() | caldav-client.ts | sendCalendarReport() — uses httpRequest() |
| 347-383 | sendFreeBusyReport() | caldav-client.ts | sendFreeBusyReport() — uses httpRequest() |
| 389-418 | parseCalendarQueryResponse() | caldav-client.ts | parseCalendarQueryResponse() — uses txml |
| 421-426 | iCal regex patterns | ical-parser.ts | Same regex patterns in TypeScript |
| 436-492 | parseICalendarData() | ical-parser.ts | parseICalendarData() |
| 494-507 | extractICalProperty() | ical-parser.ts | extractICalProperty() |
| 526-605 | parseFreeBusyResponse() | ical-parser.ts | parseFreeBusyResponse() |
| 612-623 | parseDurationEndTime() | ical-parser.ts | parseDurationEndTime() — parse ISO 8601 duration manually (regex for PT(\d+H)?(\d+M)?) since we don't have java.time.Duration |
| 629-640 | parseICalDate() | ical-parser.ts | parseICalDate() |
| 647-661 | parseICalTime() | ical-parser.ts | parseICalTime() |
| 695-731 | parsePrincipalSearchResponse() | caldav-client.ts | parsePrincipalSearchResponse() |
| 733-751 | isPrincipalResource() | caldav-client.ts | isPrincipalResource() |
| 753-787 | sendReport() | caldav-client.ts | sendReport() |
| 789-798 | isSuccessResponse() | caldav-client.ts | isSuccessResponse() |
| 801-816 | getPropertyText() | caldav-client.ts | getPropertyText() |
| 818-824 | getTextContent() | caldav-client.ts | getTextContent() |
| 830-838 | resolveHref() | caldav-client.ts | resolveHref() |
| 840-849 | normalizeUrl() | caldav-client.ts | normalizeUrl() |
| 854-879 | createTrustAllSslContext() | DROPPED | Not needed — Tauri HTTP handles SSL; Vite proxy uses secure: false |
CalDavService.java (130 lines) → src/services/caldav-client.ts (merged in)
The service layer is thin (validation + delegation + sorting). In TypeScript, we'll fold the validation and sorting directly into the client functions rather than having a separate service class.
| Java Lines | Method | Target |
|-----------|--------|--------|
| 36-44 | discoverUsers() | Validation + call merged into caldav-client.ts discoverUsers() |
| 61-72 | searchUsers() | Validation + call merged into caldav-client.ts searchUsers() |
| 89-116 | fetchWeekEvents() | Validation + sorting merged into caldav-client.ts fetchWeekEvents() |
| 118-128 | validateInputs() | caldav-client.ts validateInputs() — private helper |
CalDavView.java (876 lines) → Split across components + state + schedule model
| Java Lines | Section | Target |
|-----------|---------|--------|
| 63-128 | Class fields, state | state/app-state.ts — Preact Signals |
| 130-218 | Constructor (layout setup) | app.tsx — component tree composition |
| 224-255 | createUserSearchBox() | components/user-search.tsx |
| 257-270 | searchUsersOnServer() | state/app-state.ts — action function using searchUsers() |
| 276-289 | addSelectedUser(), removeSelectedUser() | state/app-state.ts — addUser(), removeUser() |
| 295-318 | Week navigation methods | state/app-state.ts — navigateWeek(), navigateToToday() |
| 324-351 | fetchEventsForUser(), refreshAllEvents() | state/app-state.ts — async action functions |
| 361-446 | rebuildScheduleGrid() | components/schedule-grid.tsx — reactive (re-renders when signals change) |
| 453-469 | createSlotRenderer() | components/schedule-grid.tsx — inline JSX for <td> cells |
| 475-509 | createUserCell() | components/schedule-grid.tsx — inline JSX for user name column |
| 518-599 | Schedule data computation | model/schedule.ts — pure functions |
| 604-716 | Event filtering, overlap, priority, CSS, labels, tooltips | model/schedule.ts — pure functions |
| 726-808 | openLoginDialog() | components/login-dialog.tsx |
| 813-825 | disconnect() | state/app-state.ts — disconnect() action |
| 830-842 | updateConnectionStatus() | components/toolbar.tsx — reactive (reads connected and connection signals) |
| 844-850 | onAttach() — auto-open login | app.tsx — useEffect on mount |
| 862-874 | Inner records | model/types.ts |
---
Dependency Summary
Production Dependencies
| Package | Purpose | Approx Size |
|---------|---------|-------------|
| preact | UI framework | ~4KB gzip |
| @preact/signals | Reactive state | ~2KB gzip |
| txml | XML parsing (CalDAV responses) | ~3KB gzip |
| @tauri-apps/api | Tauri runtime API | tree-shaken |
| @tauri-apps/plugin-http | HTTP requests from Rust | tree-shaken |
Dev Dependencies
| Package | Purpose |
|---------|---------|
| vite | Build tool |
| @preact/preset-vite | Preact JSX transform + HMR |
| typescript | Type checking |
| vitest | Test runner |
| @tauri-apps/cli | Tauri build tooling |
No ical.js — we're porting the regex-based iCal parsing directly from the Java code.
Total production JS bundle (estimated): ~15KB gzipped (Preact + Signals + txml + app code). Extremely lightweight.
---
Session Execution Strategy
This is too large for a single session. Recommended session breakdown:
Session 1 — Scaffold + HTTP + Types (Phases 1-3)
- Create app/ directory structure
- Initialize npm, install deps, configure Vite + TypeScript + Preact
- Initialize Tauri v2 with HTTP plugin
- Create http.ts abstraction layer
- Create all TypeScript types in model/types.ts
- Verify: npm run dev shows a placeholder page in the browser
Session 2 — CalDAV Client + iCal Parser (Phase 4)
- Port caldav-client.ts: XML building, request functions, XML response parsing
- Port ical-parser.ts: regex-based iCal/free-busy parsing
- Fold in service-layer validation and sorting
- This is the densest logic — ~1000 lines of Java → ~600-700 lines of TypeScript
Session 3 — Schedule Computation + State (Phases 5-6)
- Port all pure functions in model/schedule.ts
- Create state/app-state.ts with all signals and action functions
- Wire up actions to CalDAV client functions
Session 4 — UI Components (Phase 7)
- Build all 6 components: app shell, login dialog, toolbar, user search, week navigator, schedule grid
- The schedule grid is the bulk of the work here
Session 5 — Styling + Notifications + Polish (Phases 8-10)
- Port CSS, define custom properties
- Build toast notification system
- Configure default CalDAV URL, Tauri window settings
- End-to-end manual testing via Vite dev server
Session 6 — Tests (Phase 11)
- Port all 22 Java tests to Vitest
- Add new schedule computation tests
- Verify: npm test passes
Session 7 — CI + Cleanup (Phases 12-13)
- Write .gitlab-ci.yml
- Delete old Java project
- Move app/ to root
- Update AGENTS.md
---
Risk Areas & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| txml doesn't handle CalDAV XML well (namespaces, prefixed tags) | Parsing breaks | Write a small helper that strips namespace prefixes before parsing, or fall back to browser's built-in DOMParser (available in both browser and Tauri webview) — DOMParser is actually the safer choice and eliminates the txml dependency entirely |
| Vite dev proxy doesn't forward CalDAV REPORT method | Can't test in dev | Vite uses http-proxy which supports arbitrary HTTP methods — should work. If not, write a custom Vite plugin middleware |
| cargo-xwin cross-compilation fails in CI | No Windows builds | Alternative: use a Windows Docker image, or build on a self-hosted Windows runner, or use GitHub Actions as a secondary CI just for releases |
| Schedule grid performance with many users | Slow rendering | 120 columns × 20 rows = 2400 cells — trivial for a <table>. No virtualization needed |
| CalDAV server returns XML with unexpected namespace prefixes | Parsing breaks | Use DOMParser with namespace-aware queries (same approach as the Java code) instead of txml |
Revised dependency decision: Given the risk with txml and namespaces, use the browser's built-in DOMParser instead. This:
- Eliminates a dependency
- Gives us namespace-aware XML parsing (matching the Java DocumentBuilderFactory approach exactly)
- Is available in all browsers and Tauri's webview
- Makes the port more 1:1 with the Java code
Updated dependency list — drop txml, use DOMParser natively.
Final Dependency List (Revised)
Production
| Package | Purpose |
|---------|---------|
| preact | UI framework |
| @preact/signals | Reactive state |
| @tauri-apps/api | Tauri runtime API |
| @tauri-apps/plugin-http | HTTP requests bypassing CORS |
Dev
| Package | Purpose |
|---------|---------|
| vite | Build tool |
| @preact/preset-vite | Preact JSX + HMR |
| typescript | Type checking |
| vitest | Test runner |
| @tauri-apps/cli | Tauri CLI |
Total production dependencies: 4 packages. No XML library, no iCal library. The app uses DOMParser (built-in) for XML and hand-rolled regex parsing (ported from Java) for iCalendar data.
---
That's the complete plan. Want me to save this to disk as a file, or shall we start executing from Session 1?