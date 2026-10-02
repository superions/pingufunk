import { expect, it } from "vitest";
import { isDownloadPathInput } from "./download-path-input";

it.each(["/downloads", "downloads", "./downloads", "/synthetic/path with spaces "])(
  "preserves an existing local path syntax: %s",
  (value) => expect(isDownloadPathInput(value)).toBe(true)
);

it.each([
  "",
  "  ",
  "folder\u0000other",
  "folder\nother",
  "https://example.invalid/media",
  "file:///downloads",
  "x".repeat(4097),
  "ä".repeat(2049),
  123,
  null,
  {},
])("rejects invalid local path input", (value) => expect(isDownloadPathInput(value)).toBe(false));
