/**
 * Tests for the HTTP abstraction layer, focused on the Kerberos/SPNEGO
 * (Negotiate) handshake in `authenticatedRequest`.
 *
 * Kerberos itself can't be exercised end-to-end here (that needs a real
 * domain-joined Windows machine with a KDC — CI runners have neither), so
 * these tests mock the Tauri HTTP plugin and the `spnego_*` Tauri commands
 * to verify the *handshake orchestration* (headers, retries, cleanup) is
 * correct, independent of the native SSPI implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function mockResponse(status: number, headers: Record<string, string> = {}, body = "") {
  return {
    status,
    text: () => Promise.resolve(body),
    headers: new Headers(headers),
  };
}

function markAsWindowsTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
}

beforeEach(() => {
  fetchMock.mockReset();
  invokeMock.mockReset();
  vi.resetModules();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe("authenticatedRequest — basic auth", () => {
  it("sends a Basic Authorization header and does not touch SPNEGO", async () => {
    markAsWindowsTauri();
    const { authenticatedRequest } = await import("./http.js");
    fetchMock.mockResolvedValueOnce(mockResponse(207, {}, "<multistatus/>"));

    const response = await authenticatedRequest(
      { url: "https://example.com/caldav.php/", method: "REPORT" },
      { kind: "basic", username: "alice", password: "s3cret" }
    );

    expect(response.status).toBe(207);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Basic " + btoa("alice:s3cret"));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("authenticatedRequest — kerberos auth", () => {
  it("throws when not running as a Tauri app on Windows", async () => {
    const { authenticatedRequest } = await import("./http.js");
    await expect(
      authenticatedRequest(
        { url: "https://example.com/caldav.php/", method: "REPORT" },
        { kind: "kerberos" }
      )
    ).rejects.toThrow(/nur in der Windows-Desktop-App/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through a non-401 response without starting a handshake", async () => {
    markAsWindowsTauri();
    const { authenticatedRequest } = await import("./http.js");
    fetchMock.mockResolvedValueOnce(mockResponse(207, {}, "<multistatus/>"));

    const response = await authenticatedRequest(
      { url: "https://example.com/caldav.php/", method: "REPORT" },
      { kind: "kerberos" }
    );

    expect(response.status).toBe(207);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("passes through a 401 that does not advertise Negotiate", async () => {
    markAsWindowsTauri();
    const { authenticatedRequest } = await import("./http.js");
    fetchMock.mockResolvedValueOnce(
      mockResponse(401, { "www-authenticate": "Basic realm=\"x\"" })
    );

    const response = await authenticatedRequest(
      { url: "https://example.com/caldav.php/", method: "REPORT" },
      { kind: "kerberos" }
    );

    expect(response.status).toBe(401);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("performs a single-leg handshake (ticket accepted immediately) and cleans up", async () => {
    markAsWindowsTauri();
    const { authenticatedRequest } = await import("./http.js");

    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { "www-authenticate": "Negotiate" }))
      .mockResolvedValueOnce(mockResponse(207, {}, "<multistatus/>"));

    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "spnego_start") {
        expect(args.targetSpn).toBe("HTTP/example.com");
        return Promise.resolve({ contextId: 1, tokenB64: "tok1", done: true });
      }
      if (cmd === "spnego_cleanup") {
        expect(args.contextId).toBe(1);
        return Promise.resolve();
      }
      throw new Error("unexpected invoke: " + cmd);
    });

    const response = await authenticatedRequest(
      { url: "https://example.com/caldav.php/", method: "REPORT" },
      { kind: "kerberos" }
    );

    expect(response.status).toBe(207);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1];
    expect(secondInit.headers.Authorization).toBe("Negotiate tok1");
    expect(invokeMock).toHaveBeenCalledWith("spnego_start", { targetSpn: "HTTP/example.com" });
    expect(invokeMock).toHaveBeenCalledWith("spnego_cleanup", { contextId: 1 });
  });

  it("performs a multi-leg handshake, feeding the server's continuation token back", async () => {
    markAsWindowsTauri();
    const { authenticatedRequest } = await import("./http.js");

    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { "www-authenticate": "Negotiate" }))
      .mockResolvedValueOnce(mockResponse(401, { "www-authenticate": "Negotiate c2VydmVydG9rZW4=" }))
      .mockResolvedValueOnce(mockResponse(207, {}, "<multistatus/>"));

    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "spnego_start") {
        return Promise.resolve({ contextId: 42, tokenB64: "tok1", done: false });
      }
      if (cmd === "spnego_continue") {
        expect(args.contextId).toBe(42);
        expect(args.targetSpn).toBe("HTTP/example.com");
        expect(args.serverTokenB64).toBe("c2VydmVydG9rZW4=");
        return Promise.resolve({ contextId: 42, tokenB64: "tok2", done: true });
      }
      if (cmd === "spnego_cleanup") {
        return Promise.resolve();
      }
      throw new Error("unexpected invoke: " + cmd);
    });

    const response = await authenticatedRequest(
      { url: "https://example.com/caldav.php/", method: "REPORT" },
      { kind: "kerberos" }
    );

    expect(response.status).toBe(207);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, thirdInit] = fetchMock.mock.calls[2];
    expect(thirdInit.headers.Authorization).toBe("Negotiate tok2");
    expect(invokeMock).toHaveBeenCalledWith("spnego_cleanup", { contextId: 42 });
  });

  it("gives up and cleans up after repeated 401s without a usable continuation token", async () => {
    markAsWindowsTauri();
    const { authenticatedRequest } = await import("./http.js");

    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { "www-authenticate": "Negotiate" }))
      .mockResolvedValueOnce(mockResponse(401, { "www-authenticate": "Negotiate" }));

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "spnego_start") {
        return Promise.resolve({ contextId: 7, tokenB64: "tok1", done: false });
      }
      if (cmd === "spnego_cleanup") {
        return Promise.resolve();
      }
      throw new Error("unexpected invoke: " + cmd);
    });

    const response = await authenticatedRequest(
      { url: "https://example.com/caldav.php/", method: "REPORT" },
      { kind: "kerberos" }
    );

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledWith("spnego_cleanup", { contextId: 7 });
  });
});
