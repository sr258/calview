/**
 * Classic calendar view — vertical time axis with days as columns.
 *
 * Reads the same signals as ScheduleGrid (selectedUsers, userEvents,
 * currentWeekStart, failedUsers) but renders events as positioned
 * blocks in a Google-Calendar-style layout.
 */

import { useRef, useEffect } from "preact/hooks";
import {
  selectedUsers,
  userEvents,
  currentWeekStart,
  failedUsers,
  favorites,
} from "../state/app-state.js";
import { removeUser, toggleFavorite } from "../state/app-state.js";
import {
  WEEKDAY_COUNT,
  HOUR_HEIGHT_PX,
  CALENDAR_GRID_HEIGHT,
  formatDayHeader,
  addDays,
  generateHourLabels,
  buildPositionedEventsForDay,
  formatTimeForDisplay,
  getCssClassForEvent,
} from "../model/schedule.js";
import type { PositionedEvent } from "../model/types.js";

/** Palette of user colors for overlapping events. */
const USER_COLORS = [
  "var(--cv-primary)",           // blue
  "#e64a19",                     // deep orange
  "#7b1fa2",                     // purple
  "#00897b",                     // teal
  "#c62828",                     // red
  "#33691e",                     // green
  "#4527a0",                     // deep purple
  "#00838f",                     // cyan
];

function getUserColor(userIndex: number): string {
  return USER_COLORS[userIndex % USER_COLORS.length];
}

export function CalendarView() {
  const users = selectedUsers.value;
  const events = userEvents.value;
  const weekStart = currentWeekStart.value;
  const failed = failedUsers.value;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to ~08:00 on first render / week change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = HOUR_HEIGHT_PX; // 1 hour down from 07:00 = 08:00
    }
  }, [weekStart]);

  if (users.length === 0) {
    return (
      <div class="schedule-empty">
        Benutzer über die Suche hinzufügen, um deren Termine anzuzeigen.
      </div>
    );
  }

  const hourLabels = generateHourLabels();

  return (
    <div class="cal-view" ref={scrollRef}>
      {/* User legend */}
      <CalendarLegend />

      <div class="cal-grid-wrapper">
        {/* Time gutter */}
        <div class="cal-time-gutter">
          {hourLabels.map((label) => (
            <div key={label} class="cal-time-label" style={{ height: `${HOUR_HEIGHT_PX}px` }}>
              {label}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div class="cal-days">
          {Array.from({ length: WEEKDAY_COUNT }, (_, dayIdx) => (
            <CalendarDayColumn
              key={dayIdx}
              dayIdx={dayIdx}
              weekStart={weekStart}
              users={users}
              events={events}
              failed={failed}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Day Column ──────────────────────────────────────────────────────────────

interface DayColumnProps {
  dayIdx: number;
  weekStart: string;
  users: import("../model/types.js").CalDavUser[];
  events: Map<string, import("../model/types.js").CalDavEvent[]>;
  failed: Set<string>;
}

function CalendarDayColumn({ dayIdx, weekStart, users, events, failed }: DayColumnProps) {
  const dayDate = addDays(weekStart, dayIdx);
  const header = formatDayHeader(weekStart, dayIdx);

  // Check if any user has failed for this column
  const hasFailedUser = users.some((u) => failed.has(u.href));

  // Build positioned events for this day
  const positioned = buildPositionedEventsForDay(users, events, dayDate);

  return (
    <div class="cal-day-column">
      <div class="cal-day-header">{header}</div>
      <div class="cal-day-body" style={{ height: `${CALENDAR_GRID_HEIGHT}px` }}>
        {/* Hour grid lines */}
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            class="cal-hour-line"
            style={{ top: `${i * HOUR_HEIGHT_PX}px` }}
          />
        ))}

        {/* Half-hour grid lines */}
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={`half-${i}`}
            class="cal-half-hour-line"
            style={{ top: `${i * HOUR_HEIGHT_PX + HOUR_HEIGHT_PX / 2}px` }}
          />
        ))}

        {/* Event blocks */}
        {positioned.map((pe, i) => (
          <CalendarEventBlock key={i} pe={pe} />
        ))}

        {/* Failed user overlay */}
        {hasFailedUser && (
          <div class="cal-day-error" title="Laden fehlgeschlagen für mindestens einen Benutzer">
            ⚠
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Event Block ─────────────────────────────────────────────────────────────

function CalendarEventBlock({ pe }: { pe: PositionedEvent }) {
  const { event, user, userIndex, top, height, left, width } = pe;

  const color = getUserColor(userIndex);
  const isShort = height < 30;

  // Build label
  let label = user.displayName;
  if (event.accessible && event.summary) {
    label = event.summary;
  }

  // Build time string
  let timeStr = "";
  if (event.startTime && event.endTime) {
    timeStr = `${formatTimeForDisplay(event.startTime)} – ${formatTimeForDisplay(event.endTime)}`;
  }

  // Tooltip
  const tooltipParts = [label];
  if (timeStr) tooltipParts.push(timeStr);
  tooltipParts.push(user.displayName);
  const tooltip = tooltipParts.join("\n");

  const cssClass = getCssClassForEvent(event);

  return (
    <div
      class={`cal-event ${cssClass}`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `${left * 100}%`,
        width: `${width * 100}%`,
        borderLeftColor: color,
        "--cal-event-color": color,
      }}
      title={tooltip}
    >
      <div class="cal-event-inner">
        {!isShort && <div class="cal-event-time">{timeStr}</div>}
        <div class="cal-event-label">{label}</div>
        {!isShort && (
          <div class="cal-event-user">{user.displayName}</div>
        )}
      </div>
    </div>
  );
}

// ─── User Legend ─────────────────────────────────────────────────────────────

function CalendarLegend() {
  const users = selectedUsers.value;
  const favs = favorites.value;
  const failed = failedUsers.value;

  return (
    <div class="cal-legend">
      {users.map((user, idx) => {
        const isFailed = failed.has(user.href);
        const isFav = favs.some((f) => f.href === user.href);
        return (
          <div key={user.href} class="cal-legend-item">
            <span
              class="cal-legend-swatch"
              style={{ backgroundColor: getUserColor(idx) }}
            />
            {isFailed && (
              <span class="user-warning-icon" title="Laden fehlgeschlagen">⚠</span>
            )}
            <button
              class={`btn-favorite-star${isFav ? " filled" : ""}`}
              onClick={() => toggleFavorite(user)}
              title={isFav ? "Favorit entfernen" : "Als Favorit markieren"}
            >
              {isFav ? "★" : "☆"}
            </button>
            <span class="cal-legend-name" title={user.href}>{user.displayName}</span>
            <button
              class="btn-remove-user"
              onClick={() => removeUser(user)}
              title="Benutzer entfernen"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
