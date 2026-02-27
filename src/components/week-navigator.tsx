/**
 * Week navigation bar with Prev/Today/Next buttons and week label.
 *
 * Ported from: CalDavView.java week navigation (lines 177-199, 295-318)
 *
 * Features:
 * - Previous week button (<), Today button, week label, Next week button (>)
 * - Disabled when no users are selected
 * - Buttons call navigateWeek(-1), navigateToToday(), navigateWeek(1)
 */

import {
  selectedUsers,
  currentWeekStart,
  navigateWeek,
  navigateToToday,
} from "../state/app-state.js";
import { formatWeekLabel } from "../model/schedule.js";

export function WeekNavigator() {
  const hasUsers = selectedUsers.value.length > 0;
  const weekStart = currentWeekStart.value;
  const label = formatWeekLabel(weekStart);

  return (
    <div class="week-nav">
      <button
        class="btn btn-tertiary"
        onClick={() => navigateWeek(-1)}
        disabled={!hasUsers}
        title="Previous week"
      >
        &#x276E;
      </button>
      <button
        class="btn btn-tertiary"
        onClick={() => navigateToToday()}
        disabled={!hasUsers}
      >
        Today
      </button>
      <span class="week-label">{label}</span>
      <button
        class="btn btn-tertiary"
        onClick={() => navigateWeek(1)}
        disabled={!hasUsers}
        title="Next week"
      >
        &#x276F;
      </button>
    </div>
  );
}
