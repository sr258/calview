/**
 * User search input with dropdown results list.
 *
 * Ported from: CalDavView.java createUserSearchBox() lines 224-255
 *              CalDavView.java searchUsersOnServer() lines 257-270
 *
 * Features:
 * - Text input with placeholder "Type at least 2 characters to search..."
 * - Debounced search (300ms) when input length >= 2
 * - Dropdown list of results (filtered to exclude already-selected users)
 * - On select: call addUser(), clear input
 * - Disabled when not connected
 * - Pure HTML <input> + positioned <ul> dropdown
 */

import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import type { CalDavUser } from "../model/types.js";
import {
  connected,
  favorites,
  searchUsers,
  addUser,
  toggleFavorite,
} from "../state/app-state.js";

const MIN_SEARCH_LENGTH = 2;
const DEBOUNCE_MS = 300;

export function UserSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CalDavUser[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDisabled = !connected.value;

  // Debounced search
  const performSearch = useCallback(async (term: string) => {
    if (term.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    setSearching(true);
    const users = await searchUsers(term);
    setResults(users);
    setShowDropdown(users.length > 0);
    setHighlightedIndex(-1);
    setSearching(false);
  }, []);

  const handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setQuery(value);

    // Clear previous debounce timer
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    // Debounce the search
    debounceRef.current = setTimeout(() => {
      performSearch(value);
    }, DEBOUNCE_MS);
  };

  const handleSelectUser = async (user: CalDavUser) => {
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    setHighlightedIndex(-1);
    await addUser(user);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!showDropdown || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : results.length - 1
      );
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelectUser(results[highlightedIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inputRef.current &&
        !inputRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div class="user-search">
      <label class="user-search-label" for="user-search-input">
        Benutzer suchen
      </label>
      <div class="user-search-input-wrapper">
        <svg class="user-search-icon" viewBox="0 0 24 24" width="18" height="18">
          <path
            fill="currentColor"
            d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
          />
        </svg>
        <input
          ref={inputRef}
          id="user-search-input"
          type="text"
          class="user-search-input"
          placeholder={
            isDisabled
              ? "Verbinden, um Benutzer zu suchen"
              : `Mindestens ${MIN_SEARCH_LENGTH} Zeichen eingeben...`
          }
          value={query}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setShowDropdown(true);
          }}
          disabled={isDisabled}
        />
        {searching && <span class="user-search-spinner" />}
      </div>

      {showDropdown && results.length > 0 && (
        <ul ref={dropdownRef} class="user-search-dropdown">
          {results.map((user, idx) => {
            const isFav = favorites.value.some((u) => u.href === user.href);
            return (
              <li
                key={user.href}
                class={`user-search-item${idx === highlightedIndex ? " highlighted" : ""}`}
                onMouseDown={() => handleSelectUser(user)}
                onMouseEnter={() => setHighlightedIndex(idx)}
              >
                <div class="user-search-item-content">
                  <div class="user-search-item-text">
                    <span class="user-search-item-name">{user.displayName}</span>
                    <span class="user-search-item-href">{user.href}</span>
                  </div>
                  <button
                    class={`btn-favorite-star${isFav ? " filled" : ""}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      toggleFavorite(user);
                    }}
                    title={isFav ? "Favorit entfernen" : "Als Favorit markieren"}
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      {isFav ? (
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
