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

import type { ScheduleRow } from "../model/types.js";
import {
  scheduleRows,
  selectedUsers,
  failedUsers,
  currentWeekStart,
  removeUser,
} from "../state/app-state.js";
import {
  generateTimeSlots,
  formatDayHeader,
  formatTimeForDisplay,
  computeMergedCells,
  WEEKDAY_COUNT,
} from "../model/schedule.js";

export function ScheduleGrid() {
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

  return (
    <div class="schedule-scroll-container">
      <table class="schedule-table">
        <ScheduleHead
          weekStart={weekStart}
          timeSlots={timeSlots}
        />
        <ScheduleBody
          rows={rows}
          timeSlots={timeSlots}
          failedUsers={failed}
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

      {/* Time header row */}
      <tr>
        {Array.from({ length: WEEKDAY_COUNT }, (_, dayIdx) =>
          timeSlots.map((time, slotIdx) => {
            const isFullHour = time.endsWith(":00");
            const isFirstSlotOfDay = slotIdx === 0;
            const isLastSlotOfDay = slotIdx === timeSlots.length - 1;
            const nextIsFullHour = !isLastSlotOfDay && timeSlots[slotIdx + 1].endsWith(":00");
            return (
              <th
                key={`${dayIdx}-${time}`}
                class={`schedule-time-header${isFirstSlotOfDay && dayIdx > 0 ? " day-separator" : ""}${nextIsFullHour || isLastSlotOfDay ? " hour-separator" : ""}`}
              >
                {isFullHour ? formatTimeForDisplay(time) : ""}
              </th>
            );
          })
        )}
      </tr>
    </thead>
  );
}

// ─── Table Body ──────────────────────────────────────────────────────────────

interface ScheduleBodyProps {
  rows: ScheduleRow[];
  timeSlots: string[];
  failedUsers: Set<string>;
}

function ScheduleBody({ rows, timeSlots, failedUsers }: ScheduleBodyProps) {
  return (
    <tbody>
      {rows.map((row, rowIdx) => (
        <ScheduleRowComponent
          key={row.user?.href ?? "__all_free__"}
          row={row}
          timeSlots={timeSlots}
          isFailed={row.user !== null && failedUsers.has(row.user.href)}
          isLastRow={rowIdx === rows.length - 1}
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
  isLastRow: boolean;
}

function ScheduleRowComponent({
  row,
  timeSlots,
  isFailed,
  isLastRow,
}: ScheduleRowProps) {
  const isSummaryRow = row.user === null;
  const mergedCells = computeMergedCells(row.slots, timeSlots);

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
        >
          {cell.slot.label ?? ""}
        </td>
      ))}
    </tr>
  );
}
