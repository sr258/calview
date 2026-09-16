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
import type { EventWithOwner, PositionedEvent } from "../model/types.js";
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

/**
 * Derives a stable, well-distinguishable color from a calendar/user's display
 * name. Hashing the name (instead of cycling through a fixed palette by list
 * position) means a given person always gets the same color across app
 * restarts and regardless of selection order, and there's no hard limit on
 * the number of distinct hues before colors repeat.
 */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function userColorHsl(name: string): { hue: number; saturation: number; lightness: number } {
  const hash = hashString(name);
  // Golden-angle step spreads hues evenly regardless of hash clustering.
  const hue = (hash * 137.508) % 360;
  const saturation = 65 + (hash % 15); // 65–79%
  const lightness = 38 + ((hash >> 4) % 10); // 38–47%, keeps contrast on light bg
  return { hue, saturation, lightness };
}

function getUserColor(name: string): string {
  const { hue, saturation, lightness } = userColorHsl(name);
  return `hsl(${hue.toFixed(1)}, ${saturation}%, ${lightness}%)`;
}

/** Light background tint of the user color, for filling event blocks. */
function getUserColorTint(name: string): string {
  const { hue, saturation } = userColorHsl(name);
  return `hsla(${hue.toFixed(1)}, ${saturation}%, 50%, 0.14)`;
}

/**
 * Builds a diagonal-striped background from each owner's color tint, used
 * to mark an event that appears on more than one selected user's calendar
 * (the same appointment, detected via iCal UID or a date/time/summary
 * fallback — see `getSharedEventKeys`) so it can be shown once instead of as
 * separate overlapping blocks per owner.
 */
function getSharedEventStripeBackground(names: string[]): string {
  const stripeWidthPx = 14;
  const bandCount = names.length;
  const stops: string[] = [];
  names.forEach((name, i) => {
    const tint = getUserColorTint(name);
    const from = (i / bandCount) * stripeWidthPx;
    const to = ((i + 1) / bandCount) * stripeWidthPx;
    stops.push(`${tint} ${from}px`, `${tint} ${to}px`);
  });
  return `repeating-linear-gradient(135deg, ${stops.join(", ")})`;
}

export interface CalendarViewProps {
  onSlotClick?: (params: OutlookAppointmentParams) => void;
  onEventClick?: (entries: EventWithOwner[]) => void;
}

export function CalendarView({ onSlotClick, onEventClick }: CalendarViewProps) {
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
              onEventClick={onEventClick}
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
  onEventClick?: (entries: EventWithOwner[]) => void;
}

function CalendarDayColumn({ dayIdx, weekStart, users, events, failed, isToday, nowTop, onSlotClick, onEventClick }: DayColumnProps) {
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
          <CalendarEventBlock key={i} pe={pe} onEventClick={onEventClick} />
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

interface CalendarEventBlockProps {
  pe: PositionedEvent;
  onEventClick?: (entries: EventWithOwner[]) => void;
}

function CalendarEventBlock({ pe, onEventClick }: CalendarEventBlockProps) {
  const { event, user, top, height, left, width, owners } = pe;
  const isShared = owners.length > 1;

  const color = getUserColor(user.displayName);
  const isShort = height < 30;

  // Build label
  let label = isShared
    ? owners.map((o) => o.user.displayName).join(", ")
    : user.displayName;
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
  tooltipParts.push(
    isShared
      ? `Gemeinsamer Termin: ${owners.map((o) => o.user.displayName).join(", ")}`
      : user.displayName
  );
  if (event.accessible && event.location) {
    tooltipParts.push(`Ort: ${event.location}`);
  }
  if (event.accessible && event.attendees && event.attendees.length > 0) {
    tooltipParts.push(`Teilnehmer: ${event.attendees.join(", ")}`);
  }
  const tooltip = tooltipParts.join("\n");

  const cssClass = getCssClassForEvent(event);

  // For events on a fully-accessible calendar, the shared "slot-busy" class
  // would otherwise paint every such event with the same fixed blue
  // background/box-shadow, drowning out the per-person border color. Only
  // status-only events (free/busy without details) keep that shared,
  // status-based coloring, since there the color conveys FBTYPE, not identity.
  // Events shared across multiple owners' calendars get a diagonally striped
  // background blending every owner's color instead of a single flat tint.
  const accessibleStyle = event.accessible
    ? {
        background: isShared
          ? getSharedEventStripeBackground(owners.map((o) => o.user.displayName))
          : getUserColorTint(user.displayName),
        boxShadow: `inset 3px 0 0 ${color}`,
        color: "var(--cv-text-primary)",
      }
    : {};

  return (
    <div
      class={`cal-event ${cssClass}${isShared ? " cal-event-shared" : ""}`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `${left * 100}%`,
        width: `${width * 100}%`,
        borderLeftColor: color,
        "--cal-event-color": color,
        ...accessibleStyle,
      }}
      title={tooltip}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onEventClick?.(owners.map((o) => ({ user: o.user, event })));
      }}
    >
      <div class="cal-event-inner">
        {timeStr && (
          <div class={`cal-event-time${isShort ? " cal-event-time-short" : ""}`}>{timeStr}</div>
        )}
        <div class={`cal-event-label${isShort ? " cal-event-label-short" : ""}`}>{label}</div>
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
      {users.map((user) => {
        const isFailed = failed.has(user.href);
        const isFav = favs.some((f) => f.href === user.href);
        return (
          <div key={user.href} class="cal-legend-item">
            <span
              class="cal-legend-swatch"
              style={{ backgroundColor: getUserColor(user.displayName) }}
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
