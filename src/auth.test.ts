import { describe, expect, test } from "bun:test";
import { buildTokenSet, decodeBasecampExpiry } from "./auth.ts";

describe("decodeBasecampExpiry", () => {
  test("extracts expires_at embedded in a signed token payload", () => {
    const payload = Buffer.from(
      `\x04\b[\aI"\xb0{"client_id":"abc","expires_at":"2026-07-09T11:58:37Z"}`,
      "latin1",
    ).toString("base64");
    expect(decodeBasecampExpiry(`${payload}--deadbeef`)).toBe("2026-07-09T11:58:37Z");
  });

  test("returns null when no expiry can be parsed", () => {
    expect(decodeBasecampExpiry("not a real token")).toBeNull();
    expect(decodeBasecampExpiry("")).toBeNull();
  });
});

describe("buildTokenSet", () => {
  test("derives expires_at from expires_in", () => {
    const before = Date.now();
    const ts = buildTokenSet({ access_token: "a", refresh_token: "r", expires_in: 100 });
    const expiresAt = Date.parse(ts.expires_at);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 100_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 100_000);
    expect(ts.access_token).toBe("a");
    expect(ts.refresh_token).toBe("r");
  });

  test("falls back to the existing refresh token when the response omits it", () => {
    const ts = buildTokenSet({ access_token: "new", expires_in: 100 }, "old-refresh");
    expect(ts.refresh_token).toBe("old-refresh");
  });

  test("defaults to a 14-day expiry when expires_in is absent", () => {
    const ts = buildTokenSet({ access_token: "a", refresh_token: "r" });
    const days = (Date.parse(ts.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  test("throws when access or refresh token cannot be resolved", () => {
    expect(() => buildTokenSet({ access_token: "", refresh_token: "r" })).toThrow();
    expect(() => buildTokenSet({ access_token: "a" })).toThrow();
  });
});
