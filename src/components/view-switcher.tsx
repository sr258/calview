/**
 * Segmented toggle for switching between the table view and the
 * classic calendar view. Reads and writes the `activeView` signal.
 */

import { activeView, setView, type ViewMode } from "../state/app-state.js";

const views: { mode: ViewMode; label: string }[] = [
  { mode: "table", label: "Tabelle" },
  { mode: "calendar", label: "Kalender" },
];

export function ViewSwitcher() {
  const current = activeView.value;

  return (
    <div class="view-switcher" role="radiogroup" aria-label="Ansicht wählen">
      {views.map(({ mode, label }) => (
        <button
          key={mode}
          class={`view-switcher-btn${current === mode ? " active" : ""}`}
          role="radio"
          aria-checked={current === mode}
          onClick={() => setView(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
