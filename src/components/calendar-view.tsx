/**
 * Classic calendar view — vertical time axis with days as columns.
 *
 * Reads the same signals as ScheduleGrid (selectedUsers, userEvents,
 * currentWeekStart, failedUsers) but renders events as positioned
 * blocks in a Google-Calendar-style layout.
 */

import { useRef, useEffect, useState } from "preact/hooks";
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
import type { OutlookAppointmentParams } from "../services/outlook.js";

/** Schedule start hour (matches SCHEDULE_START "07:00"). */
const SCHEDULE_START_HOUR = 7;

/** Schedule end hour (exclusive, matches SCHEDULE_END "19:00"). */
const SCHEDULE_END_HOUR = 19;

/**
 * Returns the day index (0=Mon..4=Fri) of today within the displayed week,
 * or -1 if today is not in the current week.
 */
function getTodayDayIndex(weekStart: string): number {
  const today = new Date();
  const todayStr =
    today.getFullYear().toString() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");

  for (let i = 0; i < WEEKDAY_COUNT; i++) {
    if (addDays(weekStart, i) === todayStr) return i;
  }
  return -1;
}

/**
 * Returns the pixel offset from the top of the calendar grid for the current time,
 * or -1 if outside the schedule range.
 */
function getNowIndicatorTop(): number {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  if (hours < SCHEDULE_START_HOUR || hours >= SCHEDULE_END_HOUR) return -1;
  return ((hours - SCHEDULE_START_HOUR) * 60 + minutes) / 60 * HOUR_HEIGHT_PX;
}

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

export interface CalendarViewProps {
  onSlotClick?: (params: OutlookAppointmentParams) => void;
}

export function CalendarView({ onSlotClick }: CalendarViewProps) {
  const users = selectedUsers.value;
  const events = userEvents.value;
  const weekStart = currentWeekStart.value;
  const failed = failedUsers.value;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowTop, setNowTop] = useState(getNowIndicatorTop());

  const todayDayIdx = getTodayDayIndex(weekStart);

  // Update current time indicator every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => setNowTop(getNowIndicatorTop()), 60_000);
    return () => clearInterval(timer);
  }, []);

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
              isToday={dayIdx === todayDayIdx}
              nowTop={dayIdx === todayDayIdx ? nowTop : -1}
              onSlotClick={onSlotClick}
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
  isToday: boolean;
  nowTop: number;
  onSlotClick?: (params: OutlookAppointmentParams) => void;
}

function CalendarDayColumn({ dayIdx, weekStart, users, events, failed, isToday, nowTop, onSlotClick }: DayColumnProps) {
  const dayDate = addDays(weekStart, dayIdx);
  const header = formatDayHeader(weekStart, dayIdx);

  // Check if any user has failed for this column
  const hasFailedUser = users.some((u) => failed.has(u.href));

  // Build positioned events for this day
  const positioned = buildPositionedEventsForDay(users, events, dayDate);

  /** Handle click on the day body — compute hour from Y position. */
  const handleDayBodyClick = (e: MouseEvent) => {
    if (!onSlotClick) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const rawHour = Math.floor(clickY / HOUR_HEIGHT_PX) + SCHEDULE_START_HOUR;
    const hour = Math.max(SCHEDULE_START_HOUR, Math.min(18, rawHour));
    const date = addDays(weekStart, dayIdx);
    const attendees = selectedUsers.value.map((u) => u.displayName);

    console.log("[calendar-view] Day body clicked:", {
      dayIdx,
      clickY: Math.round(clickY),
      rawHour,
      hour,
      date,
      attendeeCount: attendees.length,
    });

    onSlotClick({ date, hour, attendees });
  };

  return (
    <div class={`cal-day-column${isToday ? " cal-day-today" : ""}`}>
      <div class={`cal-day-header${isToday ? " cal-day-header-today" : ""}`}>{header}</div>
      <div class="cal-day-body" style={{ height: `${CALENDAR_GRID_HEIGHT}px` }} onClick={handleDayBodyClick}>
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

        {/* Hour hover zones */}
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={`hover-${i}`}
            class="cal-hour-hover-zone"
            style={{ top: `${i * HOUR_HEIGHT_PX}px`, height: `${HOUR_HEIGHT_PX}px` }}
          />
        ))}

        {/* Current time indicator */}
        {nowTop >= 0 && (
          <div class="cal-now-indicator" style={{ top: `${nowTop}px` }}>
            <div class="cal-now-dot" />
            <div class="cal-now-line" />
          </div>
        )}

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
