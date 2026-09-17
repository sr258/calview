/**
 * Tests for credential persistence, focused on the Basic vs. Kerberos
 * round-trip through the localStorage backend (the Tauri keychain backend
 * is a thin invoke() wrapper around the same StoredCredentials shape and
 * is exercised implicitly via the Rust `save_credentials`/`get_credentials`
 * commands, which can't run outside a real Tauri/Windows environment).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveCredentials, loadCredentials, clearCredentials } from "./credential-store.js";

const LOCAL_STORAGE_KEY = "calview_credentials";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("credential-store — basic auth", () => {
  it("round-trips username/password through localStorage", async () => {
    await saveCredentials({
      url: "https://example.com/caldav.php/",
      auth: { kind: "basic", username: "alice", password: "s3cret" },
      acceptInvalidCerts: true,
    });

    const loaded = await loadCredentials();
    expect(loaded).toEqual({
      url: "https://example.com/caldav.php/",
      auth: { kind: "basic", username: "alice", password: "s3cret" },
      acceptInvalidCerts: true,
    });
  });

  it("never stores the raw password in plaintext", async () => {
    await saveCredentials({
      url: "https://example.com/caldav.php/",
      auth: { kind: "basic", username: "alice", password: "s3cret" },
    });

    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)!;
    expect(raw).not.toContain("s3cret");
  });
});

describe("credential-store — kerberos auth", () => {
  it("round-trips a Kerberos connection without any secret", async () => {
    await saveCredentials({
      url: "https://example.com/caldav.php/",
      auth: { kind: "kerberos" },
      acceptInvalidCerts: false,
    });

    const loaded = await loadCredentials();
    expect(loaded).toEqual({
      url: "https://example.com/caldav.php/",
      auth: { kind: "kerberos" },
      acceptInvalidCerts: false,
    });
  });

  it("stores no authHeader for Kerberos connections", async () => {
    await saveCredentials({
      url: "https://example.com/caldav.php/",
      auth: { kind: "kerberos" },
    });

    const raw = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
    expect(raw.authMode).toBe("kerberos");
    expect(raw.authHeader).toBeFalsy();
  });
});

describe("credential-store — clearCredentials", () => {
  it("removes stored credentials", async () => {
    await saveCredentials({
      url: "https://example.com/caldav.php/",
      auth: { kind: "kerberos" },
    });
    await clearCredentials();

    expect(await loadCredentials()).toBeNull();
  });
});

describe("credential-store — malformed data", () => {
  it("returns null for corrupted JSON", async () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, "not json");
    expect(await loadCredentials()).toBeNull();
  });

  it("returns null when a basic-mode entry is missing its authHeader", async () => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({ url: "https://example.com/", authMode: "basic" })
    );
    expect(await loadCredentials()).toBeNull();
  });
});
