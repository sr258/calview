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

import type { ScheduleRow, CalDavUser } from "../model/types.js";
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
} from "../model/schedule.js";

export interface ScheduleGridProps {
  onSlotClick?: (params: OutlookAppointmentParams) => void;
}

export function ScheduleGrid({ onSlotClick }: ScheduleGridProps) {
  const rows = scheduleRows.value;
  const users = selectedUsers.value;

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

  return (
    <div class="schedule-scroll-container">
      <table class="schedule-table" style={{ width: `${tableWidth}px` }}>
        <ScheduleHead
          weekStart={weekStart}
          timeSlots={timeSlots}
        />
        <ScheduleBody
          rows={rows}
          timeSlots={timeSlots}
          failedUsers={failed}
          favorites={favs}
          onSlotClick={onSlotClick}
        />
      </table>
    </div>
  );
}

// ─── Table Head ──────────────────────────────────────────────────────────────

interface ScheduleHeadProps {
  weekStart: string;
  timeSlots: string[];
}

function ScheduleHead({ weekStart, timeSlots }: ScheduleHeadProps) {
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
            class={`schedule-day-header${dayIdx > 0 ? " day-separator" : ""}`}
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
                class={`schedule-time-header${slotIdx === 0 && dayIdx > 0 ? " day-separator" : ""}`}
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
  onSlotClick?: (params: OutlookAppointmentParams) => void;
}

function ScheduleBody({ rows, timeSlots, failedUsers, favorites, onSlotClick }: ScheduleBodyProps) {
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

  /** Extract time from slot key "dayIdx-HH:mm" and trigger Outlook. */
  const handleSlotClick = (dayIdx: number, slotKey: string) => {
    if (!onSlotClick) return;

    const weekStart = currentWeekStart.value;
    const date = addDays(weekStart, dayIdx);
    // Slot key format: "dayIdx-HH:mm" → extract time part after first "-"
    const slotTime = slotKey.substring(slotKey.indexOf("-") + 1);
    const hour = parseInt(slotTime.split(":")[0], 10);
    const attendees = selectedUsers.value.map((u) => u.displayName);

    console.log("[schedule-grid] Slot clicked:", {
      dayIdx,
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
      {mergedCells.map((cell) => (
        <td
          key={cell.key}
          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
          class={`schedule-cell${cell.slot.cssClass ? ` ${cell.slot.cssClass}` : ""}${cell.isFirstSlotOfDay && cell.dayIdx > 0 ? " day-separator" : ""}${cell.endsAtFullHour ? " hour-separator" : ""}`}
          title={cell.slot.tooltip ?? undefined}
          onClick={() => handleSlotClick(cell.dayIdx, cell.key)}
        >
          {cell.slot.label ? (
            <div class="schedule-cell-label">{cell.slot.label}</div>
          ) : null}
        </td>
      ))}
    </tr>
  );
}
