/**
 * The main weekly schedule grid displayed as an HTML <table>.
 *
 * Ported from: CalDavView.java rebuildScheduleGrid() lines 361-446,
 *              createSlotRenderer() lines 453-469,
 *              createUserCell() lines 475-509
 *
 * Structure:
 * <table>
 *   <thead>
 *     <tr>  -- Day header row: <th colspan="144">Mon Feb 10</th> x 5 days
 *     <tr>  -- Time header row: <th>7:00</th><th></th>...<th>8:00</th>... per day
 *   </thead>
 *   <tbody>
 *     <tr>  -- One per user: <td>Name [X]</td> + merged slot <td>s (colSpan for events)
 *     <tr>  -- "All Free" summary row
 *   </tbody>
 * </table>
 *
 * Features:
 * - 5-minute time resolution (144 slots per day, 720 total)
 * - Adjacent slots for the same event are merged via colSpan
 * - First column is frozen (CSS position: sticky; left: 0)
 * - Each slot <td> has CSS class from SlotInfo.cssClass and title from tooltip
 * - User name cell: name + remove button (X), warning icon if user failed
 * - "All Free" row: user === null, bold label
 * - Table wrapped in a horizontally scrollable container
 * - 720 slot columns at 5px each = 3600px wide + user column
 */

import { useState, useEffect, useRef } from "preact/hooks";
import type { ScheduleRow, CalDavUser, MergedCell } from "../model/types.js";
import type { OutlookAppointmentParams } from "../services/outlook.js";
import {
  scheduleRows,
  selectedUsers,
  failedUsers,
  favorites,
  currentWeekStart,
  removeUser,
  toggleFavorite,
} from "../state/app-state.js";
import {
  generateTimeSlots,
  formatDayHeader,
  formatTimeForDisplay,
  computeMergedCells,
  addDays,
  WEEKDAY_COUNT,
  SLOT_MINUTES,
  SLOT_WIDTH_PX,
  USER_COL_WIDTH_PX,
  SCHEDULE_START,
  SCHEDULE_END,
} from "../model/schedule.js";

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
 * Returns the current time as "HH:mm".
 */
function getCurrentTime(): string {
  const now = new Date();
  return (
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0")
  );
}

export interface ScheduleGridProps {
  onSlotClick?: (params: OutlookAppointmentParams) => void;
}

export function ScheduleGrid({ onSlotClick }: ScheduleGridProps) {
  const rows = scheduleRows.value;
  const users = selectedUsers.value;
  const [currentTime, setCurrentTime] = useState(getCurrentTime());

  // Update current time every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(getCurrentTime()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (users.length === 0) {
    return (
      <div class="schedule-empty">
        Keine Benutzer ausgewählt. Verwenden Sie die Suchbox oben, um Benutzer zu finden und hinzuzufügen.
      </div>
    );
  }

  const timeSlots = generateTimeSlots();
  const weekStart = currentWeekStart.value;
  const failed = failedUsers.value;
  const favs = favorites.value;
  const totalSlotCols = timeSlots.length * WEEKDAY_COUNT;
  const tableWidth = USER_COL_WIDTH_PX + totalSlotCols * SLOT_WIDTH_PX;
  const todayDayIdx = getTodayDayIndex(weekStart);

  // Compute the pixel offset of the current time indicator within today's column
  let nowIndicatorLeft = -1;
  if (todayDayIdx >= 0 && currentTime >= SCHEDULE_START && currentTime < SCHEDULE_END) {
    // Parse current time to minutes since SCHEDULE_START
    const [ch, cm] = currentTime.split(":").map(Number);
    const [sh, sm] = SCHEDULE_START.split(":").map(Number);
    const minutesSinceStart = (ch * 60 + cm) - (sh * 60 + sm);
    const slotOffset = minutesSinceStart / SLOT_MINUTES;
    nowIndicatorLeft = USER_COL_WIDTH_PX + (todayDayIdx * timeSlots.length + slotOffset) * SLOT_WIDTH_PX;
  }

  const tableRef = useRef<HTMLTableElement>(null);

  // Hour-level hover: highlight cells in the "Alle frei" summary row
  // for the hour the mouse is over (anywhere in the table).
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    let lastGroup: string | null = null;

    /**
     * Determine the "dayIdx-HH" hour group from a hovered <td>.
     * Single-hour cells carry data-hour-group directly.
     * Multi-hour merged cells need mouse-position calculation.
     */
    const resolveHourGroup = (td: HTMLElement, clientX: number): string | null => {
      const group = td.getAttribute("data-hour-group");
      if (group) return group;

      const dayIdx = td.getAttribute("data-day-idx");
      const startSlotTime = td.getAttribute("data-start-time");
      if (!dayIdx || !startSlotTime) return null;

      const rect = td.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const colSpan = parseInt(td.getAttribute("colspan") ?? "1", 10);
      const slotIndex = Math.floor(fraction * colSpan);
      const [sh, sm] = startSlotTime.split(":").map(Number);
      const currentMinutes = sh * 60 + sm + slotIndex * SLOT_MINUTES;
      const hh = String(Math.floor(currentMinutes / 60)).padStart(2, "0");
      return `${dayIdx}-${hh}`;
    };

    const HOVER_CLASSES = ["hour-hover", "hour-hover-left", "hour-hover-right"] as const;

    const applyHover = (group: string | null) => {
      if (group === lastGroup) return;

      // Clear previous
      if (lastGroup) {
        const prev = table.querySelectorAll(".hour-hover");
        for (let i = 0; i < prev.length; i++) {
          prev[i].classList.remove(...HOVER_CLASSES);
        }
      }
      lastGroup = group;
      if (!group) return;

      // Find the summary row
      const summaryRow = table.querySelector("tr.schedule-summary-row");
      if (!summaryRow) return;

      // Collect matching cells in the summary row:
      // 1. Exact match via data-hour-group
      const escaped = CSS.escape(group);
      const cells: HTMLElement[] = Array.from(
        summaryRow.querySelectorAll<HTMLElement>(`[data-hour-group="${escaped}"]`)
      );

      // 2. Multi-hour merged cells that overlap this hour (rare in summary row, but safe)
      const [dayIdx, hh] = group.split("-");
      const hourNum = parseInt(hh, 10);
      const hourStartMin = hourNum * 60;
      const hourEndMin = hourStartMin + 60;
      const multiCells = summaryRow.querySelectorAll<HTMLElement>(
        `td[data-day-idx="${CSS.escape(dayIdx)}"][data-start-time]`
      );
      for (let i = 0; i < multiCells.length; i++) {
        const td = multiCells[i];
        const st = td.getAttribute("data-start-time")!;
        const cs = parseInt(td.getAttribute("colspan") ?? "1", 10);
        const [ssh, ssm] = st.split(":").map(Number);
        const sMin = ssh * 60 + ssm;
        if (sMin < hourEndMin && sMin + cs * SLOT_MINUTES > hourStartMin) {
          if (!cells.includes(td)) cells.push(td);
        }
      }

      if (cells.length === 0) return;

      // Sort by DOM order and apply classes
      const children = Array.from(summaryRow.children);
      cells.sort((a, b) => children.indexOf(a) - children.indexOf(b));

      for (let i = 0; i < cells.length; i++) {
        const td = cells[i];
        td.classList.add("hour-hover");
        if (i === 0) td.classList.add("hour-hover-left");
        if (i === cells.length - 1) td.classList.add("hour-hover-right");
      }
    };

    const onOver = (e: Event) => {
      const me = e as MouseEvent;
      const td = (me.target as HTMLElement).closest<HTMLElement>(
        "td[data-hour-group], td[data-day-idx]"
      );
      if (!td) { applyHover(null); return; }
      applyHover(resolveHourGroup(td, me.clientX));
    };

    const onMove = (e: Event) => {
      const me = e as MouseEvent;
      const td = (me.target as HTMLElement).closest<HTMLElement>("td[data-day-idx][data-start-time]");
      if (!td) return;
      applyHover(resolveHourGroup(td, me.clientX));
    };

    const onLeave = () => {
      if (lastGroup) {
        const prev = table.querySelectorAll(".hour-hover");
        for (let i = 0; i < prev.length; i++) prev[i].classList.remove(...HOVER_CLASSES);
      }
      lastGroup = null;
    };

    table.addEventListener("mouseover", onOver);
    table.addEventListener("mousemove", onMove);
    table.addEventListener("mouseleave", onLeave);
    return () => {
      table.removeEventListener("mouseover", onOver);
      table.removeEventListener("mousemove", onMove);
      table.removeEventListener("mouseleave", onLeave);
    };
   });

  return (
    <div class="schedule-scroll-container">
      <table
        ref={tableRef}
        class="schedule-table"
        style={{ width: `${tableWidth}px` }}
      >
        <ScheduleHead
          weekStart={weekStart}
          timeSlots={timeSlots}
          todayDayIdx={todayDayIdx}
        />
        <ScheduleBody
          rows={rows}
          timeSlots={timeSlots}
          failedUsers={failed}
          favorites={favs}
          todayDayIdx={todayDayIdx}
          onSlotClick={onSlotClick}
        />
      </table>
      {nowIndicatorLeft >= 0 && (
        <div
          class="schedule-now-indicator"
          style={{ left: `${nowIndicatorLeft}px` }}
        />
      )}
    </div>
  );
}

// ─── Table Head ──────────────────────────────────────────────────────────────

interface ScheduleHeadProps {
  weekStart: string;
  timeSlots: string[];
  todayDayIdx: number;
}

function ScheduleHead({ weekStart, timeSlots, todayDayIdx }: ScheduleHeadProps) {
  return (
    <thead>
      {/* Day header row */}
      <tr>
        <th class="schedule-corner-cell" rowSpan={2}>
          Benutzer
        </th>
        {Array.from({ length: WEEKDAY_COUNT }, (_, dayIdx) => (
          <th
            key={dayIdx}
            class={`schedule-day-header${dayIdx > 0 ? " day-separator" : ""}${dayIdx === todayDayIdx ? " today-column" : ""}`}
            colSpan={timeSlots.length}
          >
            {formatDayHeader(weekStart, dayIdx)}
          </th>
        ))}
      </tr>

      {/* Time header row: one <th> per hour with colspan */}
      <tr>
        {Array.from({ length: WEEKDAY_COUNT }, (_, dayIdx) => {
          const slotsPerHour = 60 / SLOT_MINUTES;
          const hourCount = timeSlots.length / slotsPerHour;
          return Array.from({ length: hourCount }, (_, hourIdx) => {
            const slotIdx = hourIdx * slotsPerHour;
            const time = timeSlots[slotIdx];
            return (
              <th
                key={`${dayIdx}-${time}`}
                class={`schedule-time-header${slotIdx === 0 && dayIdx > 0 ? " day-separator" : ""}${dayIdx === todayDayIdx ? " today-column" : ""}`}
                colSpan={slotsPerHour}
              >
                {formatTimeForDisplay(time)}
              </th>
            );
          });
        })}
      </tr>
    </thead>
  );
}

// ─── Table Body ──────────────────────────────────────────────────────────────

interface ScheduleBodyProps {
  rows: ScheduleRow[];
  timeSlots: string[];
  failedUsers: Set<string>;
  favorites: CalDavUser[];
  todayDayIdx: number;
  onSlotClick?: (params: OutlookAppointmentParams) => void;
}

function ScheduleBody({ rows, timeSlots, failedUsers, favorites, todayDayIdx, onSlotClick }: ScheduleBodyProps) {
  return (
    <tbody>
      {rows.map((row, rowIdx) => (
        <ScheduleRowComponent
          key={row.user?.href ?? "__all_free__"}
          row={row}
          timeSlots={timeSlots}
          isFailed={row.user !== null && failedUsers.has(row.user.href)}
          isFavorite={row.user !== null && favorites.some((u) => u.href === row.user!.href)}
          isLastRow={rowIdx === rows.length - 1}
          onSlotClick={onSlotClick}
        />
      ))}
    </tbody>
  );
}

// ─── Single Row ──────────────────────────────────────────────────────────────

interface ScheduleRowProps {
  row: ScheduleRow;
  timeSlots: string[];
  isFailed: boolean;
  isFavorite: boolean;
  isLastRow: boolean;
  onSlotClick?: (params: OutlookAppointmentParams) => void;
}

function ScheduleRowComponent({
  row,
  timeSlots,
  isFailed,
  isFavorite,
  isLastRow,
  onSlotClick,
}: ScheduleRowProps) {
  const isSummaryRow = row.user === null;
  const mergedCells = computeMergedCells(row.slots, timeSlots);

  /**
   * Calculate the actual hour from the mouse position within a cell.
   * For single-hour cells, just uses the slot key. For multi-hour merged
   * cells, computes the hour based on where in the cell the click landed.
   */
  const handleSlotClick = (e: MouseEvent, cell: MergedCell) => {
    if (!onSlotClick) return;

    const weekStart = currentWeekStart.value;
    const date = addDays(weekStart, cell.dayIdx);
    const attendees = selectedUsers.value.map((u) => u.displayName);

    let hour: number;
    const slotTime = cell.key.substring(cell.key.indexOf("-") + 1);
    const [sh, sm] = slotTime.split(":").map(Number);

    // Check if cell spans multiple hours
    const cellMinutes = cell.colSpan * SLOT_MINUTES;
    const startMinutes = sh * 60 + sm;
    const endMinutes = startMinutes + cellMinutes;
    const startHour = sh;
    const endHour = Math.ceil(endMinutes / 60);

    if (endHour - startHour > 1) {
      // Multi-hour cell: determine hour from click position
      const td = (e.target as HTMLElement).closest("td");
      if (td) {
        const rect = td.getBoundingClientRect();
        const xOffset = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, xOffset / rect.width));
        const slotIndex = Math.floor(fraction * cell.colSpan);
        const clickedMinutes = startMinutes + slotIndex * SLOT_MINUTES;
        hour = Math.floor(clickedMinutes / 60);
      } else {
        hour = sh;
      }
    } else {
      hour = sh;
    }

    console.log("[schedule-grid] Slot clicked:", {
      dayIdx: cell.dayIdx,
      slotTime,
      date,
      hour,
      attendeeCount: attendees.length,
    });

    onSlotClick({ date, hour, attendees });
  };

  return (
    <tr class={isSummaryRow ? "schedule-summary-row" : "schedule-user-row"}>
      {/* User name cell (frozen) */}
      <td class="schedule-user-cell-td">
        {isSummaryRow ? (
          <span class="schedule-summary-cell">Alle frei</span>
        ) : (
          <div class="schedule-user-cell">
            {isFailed && (
              <svg
                class="user-warning-icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                title="Termine konnten nicht geladen werden"
              >
                <path
                  fill="currentColor"
                  d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"
                />
              </svg>
            )}
            <button
              class={`btn-favorite-star${isFavorite ? " filled" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(row.user!);
              }}
              title={isFavorite ? "Favorit entfernen" : "Als Favorit markieren"}
              type="button"
            >
              <svg viewBox="0 0 24 24" width="14" height="14">
                {isFavorite ? (
                  <path
                    fill="currentColor"
                    d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                  />
                ) : (
                  <path
                    fill="currentColor"
                    d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"
                  />
                )}
              </svg>
            </button>
            <span class="user-name">{row.user!.displayName}</span>
            <button
              class="btn-remove-user"
              onClick={() => removeUser(row.user!)}
              title={`${row.user!.displayName} entfernen`}
            >
              &times;
            </button>
          </div>
        )}
      </td>

      {/* Slot cells (merged) */}
      {mergedCells.map((cell) => {
        // Determine if this cell spans multiple hours
        const slotTime = cell.key.substring(cell.key.indexOf("-") + 1);
        const [sh, sm] = slotTime.split(":").map(Number);
        const cellMinutes = cell.colSpan * SLOT_MINUTES;
        const startMinutes = sh * 60 + sm;
        const endMinutes = startMinutes + cellMinutes;
        const startHour = sh;
        const endHour = Math.ceil(endMinutes / 60);
        const spansMultipleHours = endHour - startHour > 1;

        // For single-hour cells: "dayIdx-HH" for direct hour-group matching.
        // For multi-hour cells: use data-day-idx + data-start-time so the JS
        // hover handler can compute the hour from mouse position.
        const hourPart = `${cell.dayIdx}-${String(sh).padStart(2, "0")}`;

        return (
          <td
            key={cell.key}
            colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
            class={`schedule-cell${cell.slot.cssClass ? ` ${cell.slot.cssClass}` : ""}${cell.isFirstSlotOfDay && cell.dayIdx > 0 ? " day-separator" : ""}${cell.endsAtFullHour ? " hour-separator" : ""}`}
            title={cell.slot.tooltip ?? undefined}
            {...(spansMultipleHours
              ? { "data-day-idx": String(cell.dayIdx), "data-start-time": slotTime }
              : { "data-hour-group": hourPart }
            )}
            onClick={(e: MouseEvent) => handleSlotClick(e, cell)}
          >
            {cell.slot.label ? (
              <div class="schedule-cell-label">{cell.slot.label}</div>
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}
