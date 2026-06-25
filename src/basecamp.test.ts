import { describe, expect, test } from "bun:test";
import { nextLink } from "./basecamp.ts";

describe("nextLink", () => {
  test("extracts the rel=next URL", () => {
    const header =
      '<https://3.basecampapi.com/1/projects/recordings.json?page=2>; rel="next"';
    expect(nextLink(header)).toBe(
      "https://3.basecampapi.com/1/projects/recordings.json?page=2",
    );
  });

  test("picks next out of a multi-rel header", () => {
    const header =
      '<https://example.com/a?page=1>; rel="prev", <https://example.com/a?page=3>; rel="next"';
    expect(nextLink(header)).toBe("https://example.com/a?page=3");
  });

  test("returns null when there is no next link", () => {
    expect(nextLink('<https://example.com/a?page=1>; rel="prev"')).toBeNull();
    expect(nextLink(null)).toBeNull();
    expect(nextLink("")).toBeNull();
  });
});
