/**
 * Collapsible favorites section displayed below the search box.
 *
 * Shows a list of favorited users as clickable chips. Clicking a chip
 * adds the user to the schedule grid (unless already added). Each chip
 * also has a star button to remove from favorites.
 *
 * The section is hidden when not connected or when there are no favorites.
 */

import { useState } from "preact/hooks";
import type { CalDavUser } from "../model/types.js";
import {
  connected,
  favorites,
  selectedUsers,
  addUser,
  toggleFavorite,
} from "../state/app-state.js";

export function FavoritesList() {
  const isConnected = connected.value;
  const favs = favorites.value;
  const selected = selectedUsers.value;

  if (!isConnected || favs.length === 0) {
    return null;
  }

  const selectedHrefs = new Set(selected.map((u) => u.href));

  return (
    <FavoritesSection
      favorites={favs}
      selectedHrefs={selectedHrefs}
    />
  );
}

interface FavoritesSectionProps {
  favorites: CalDavUser[];
  selectedHrefs: Set<string>;
}

function FavoritesSection({ favorites, selectedHrefs }: FavoritesSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div class="favorites-section">
      <button
        class="favorites-header"
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <svg
          class={`favorites-chevron${collapsed ? " collapsed" : ""}`}
          viewBox="0 0 24 24"
          width="16"
          height="16"
        >
          <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
        </svg>
        <span class="favorites-header-label">
          Favoriten ({favorites.length})
        </span>
      </button>

      {!collapsed && (
        <div class="favorites-chips">
          {favorites.map((user) => {
            const isAlreadySelected = selectedHrefs.has(user.href);
            return (
              <FavoriteChip
                key={user.href}
                user={user}
                isAlreadySelected={isAlreadySelected}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface FavoriteChipProps {
  user: CalDavUser;
  isAlreadySelected: boolean;
}

function FavoriteChip({ user, isAlreadySelected }: FavoriteChipProps) {
  const handleClick = () => {
    if (!isAlreadySelected) {
      addUser(user);
    }
  };

  const handleUnfavorite = (e: Event) => {
    e.stopPropagation();
    toggleFavorite(user);
  };

  return (
    <button
      class={`favorite-chip${isAlreadySelected ? " already-selected" : ""}`}
      onClick={handleClick}
      title={
        isAlreadySelected
          ? "Bereits hinzugefügt"
          : `${user.displayName} hinzufügen`
      }
      type="button"
    >
      <span class="favorite-chip-name">{user.displayName}</span>
      <span
        class="btn-favorite-star filled"
        onClick={handleUnfavorite}
        title="Favorit entfernen"
        role="button"
      >
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path
            fill="currentColor"
            d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
          />
        </svg>
      </span>
    </button>
  );
}
