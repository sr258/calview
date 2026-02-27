# AI TOOL GUIDANCE

This file provides guidance when working with code in this repository.

## Technology Stack

CalView is a CalDAV calendar viewer / appointment planner, packaged as a Tauri v2 desktop application.

| Layer | Choice |
|-------|--------|
| UI Framework | Preact + JSX/TSX |
| Reactivity | Preact Signals (`@preact/signals`) |
| Build Tool | Vite + `@preact/preset-vite` |
| Language | TypeScript (strict mode, ES2022) |
| Styling | Plain CSS with custom properties |
| HTTP (production) | `@tauri-apps/plugin-http` (Rust-side, bypasses CORS) |
| HTTP (development) | `fetch()` via Vite dev server proxy |
| XML Parsing | Browser built-in `DOMParser` |
| iCal Parsing | Hand-rolled regex (ported from Java) |
| Desktop Packaging | Tauri v2 |
| Testing | Vitest with jsdom |
| Package Manager | npm |
| CI | GitLab CI, Linux runner, cross-compile Windows .exe via cargo-xwin |

## Development Commands

### Running the Application
```bash
npm run dev              # Start Vite dev server (http://localhost:5173)
```

The Vite dev server proxies `/api/caldav` requests to the CalDAV server (`https://isb-kalender.zit.mwn.de/caldav.php`).

### Building for Production
```bash
npm run build            # TypeScript check + Vite production build (outputs to dist/)
npx tauri build          # Build Tauri desktop app (calls npm run build internally)
```

### Testing
```bash
npm test                 # Run all tests (vitest run)
npm run test:watch       # Run tests in watch mode (vitest)
```

### Tauri Desktop App
```bash
npx tauri dev            # Start Tauri dev window (starts Vite dev server automatically)
npx tauri build          # Build production desktop app
```

## Project Structure

```
calview/
├── index.html                    # Vite entry HTML (<div id="app">)
├── package.json                  # npm config, scripts, dependencies
├── tsconfig.json                 # TypeScript strict config (JSX for Preact)
├── vite.config.ts                # Preact preset, dev proxy, test config
├── .gitlab-ci.yml                # CI: test + cross-compile Windows build
├── src/
│   ├── main.tsx                  # Entry point: renders <App /> into #app
│   ├── app.tsx                   # Root component: assembles all UI pieces
│   ├── components/
│   │   ├── login-dialog.tsx      # Modal login form (URL, username, password)
│   │   ├── toolbar.tsx           # Top bar: title, connection status, connect button
│   │   ├── user-search.tsx       # Search input + dropdown results list
│   │   ├── week-navigator.tsx    # Prev/Next/Today buttons + week label
│   │   ├── schedule-grid.tsx     # Main weekly schedule table (120 time slots)
│   │   └── notifications.tsx     # Toast notification system
│   ├── services/
│   │   ├── http.ts               # HTTP abstraction (Tauri plugin vs fetch)
│   │   ├── caldav-client.ts      # CalDAV protocol: XML building, REPORT requests, parsing
│   │   ├── caldav-client.test.ts # CalDAV client tests (28 tests)
│   │   └── ical-parser.ts        # iCalendar text parsing (regex-based)
│   ├── model/
│   │   ├── types.ts              # CalDavUser, CalDavEvent, ConnectionInfo, ScheduleRow, etc.
│   │   ├── schedule.ts           # Pure functions: slot computation, free-slot logic
│   │   └── schedule.test.ts      # Schedule computation tests (54 tests)
│   ├── state/
│   │   └── app-state.ts          # Preact Signals: all app state + action functions
│   └── styles/
│       ├── index.css             # Global resets, layout, CSS custom properties
│       └── schedule.css          # Schedule grid styles (slot colors, layout)
├── src-tauri/                    # Tauri v2 Rust backend
│   ├── src/
│   │   ├── lib.rs                # Registers HTTP plugin
│   │   └── main.rs               # Tauri entry point
│   ├── Cargo.toml                # Rust dependencies (tauri, tauri-plugin-http)
│   ├── tauri.conf.json           # App config: window, build commands, HTTP permissions
│   ├── capabilities/
│   │   └── default.json          # Tauri v2 capability: allow HTTPS requests
│   └── build.rs                  # Tauri build script
└── LICENSE.md                    # Unlicense (public domain)
```

## Architecture

### Data Flow

1. **User connects** -- `connect()` in `app-state.ts` validates credentials via CalDAV principal search
2. **User searches** -- `searchUsers()` sends REPORT request, parses XML response into `CalDavUser[]`
3. **User adds person** -- `addUser()` fetches week events via calendar query (falls back to free-busy)
4. **Schedule renders** -- `schedule.ts` pure functions compute time slots, overlap, priorities into `ScheduleRow[]`
5. **UI updates** -- Preact Signals automatically trigger re-renders in components that read signals

### Key Architecture Patterns

1. **Signal-based State**: All mutable state lives in `app-state.ts` as Preact Signals. Components are reactive and re-render when the signals they read change.
2. **Pure Computation**: Schedule logic (slot mapping, overlap detection, CSS class selection) is implemented as pure functions in `model/schedule.ts`, fully testable without UI.
3. **HTTP Abstraction**: `services/http.ts` detects Tauri vs browser at runtime. In dev, requests go through Vite's proxy. In production, Tauri's Rust HTTP plugin bypasses CORS.
4. **No External XML/iCal Libraries**: XML is parsed with the browser's built-in `DOMParser`. iCalendar data is parsed with regex (ported 1:1 from the original Java implementation).

### Action Functions (in `app-state.ts`)

- `connect(url, username, password)` -- validate, test search, set connection
- `addUser(user)` / `removeUser(user)` -- manage selected users
- `navigateWeek(offset)` / `navigateToToday()` -- change displayed week
- `refreshAllEvents()` -- re-fetch events for all selected users
- `disconnect()` -- clear all state

### CalDAV Protocol (in `caldav-client.ts`)

- `searchUsers(conn, searchTerm)` -- REPORT with principal-property-search XML
- `fetchWeekEvents(conn, userHref, weekStart)` -- calendar-query REPORT, falls back to free-busy REPORT on 403
- XML building functions for CalDAV request bodies
- Response parsing using `DOMParser` with namespace-aware queries

## CSS Custom Properties

The app uses `--cv-*` custom properties (defined in `styles/index.css`) replacing the original Vaadin Lumo variables:

| Variable | Purpose |
|----------|---------|
| `--cv-primary` | Primary color (#1676f3) |
| `--cv-warning` | Warning color (#f0a030) |
| `--cv-error` | Error color (#e53935) |
| `--cv-success-text` | Success text color (#2e7d32) |
| `--cv-contrast-*` | Contrast/border colors |
| `--cv-text-secondary` | Secondary text color |
