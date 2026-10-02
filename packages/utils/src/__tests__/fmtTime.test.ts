import { describe, it, expect } from "vitest";
import { fmtTime } from "../index";

// fmtTime renders in America/New_York regardless of the machine's zone, so
// inputs are explicit UTC instants (EDT = UTC-4 in August, EST = UTC-5 in
// January). Offset-less inputs would parse in local time and make the tests
// depend on where they run.
describe("fmtTime", () => {
  it("formats midnight as 12:00 AM", () => {
    expect(fmtTime("2026-08-16T04:00:00Z")).toBe("12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(fmtTime("2026-08-16T16:00:00Z")).toBe("12:00 PM");
  });

  it("formats 7am on the hour", () => {
    expect(fmtTime("2026-08-16T11:00:00Z")).toBe("7:00 AM");
  });

  it("formats 7:30am with minutes", () => {
    expect(fmtTime("2026-08-16T11:30:00Z")).toBe("7:30 AM");
  });

  it("formats 1pm", () => {
    expect(fmtTime("2026-08-16T17:00:00Z")).toBe("1:00 PM");
  });

  it("formats 1:05pm (zero-padded minutes)", () => {
    expect(fmtTime("2026-08-16T17:05:00Z")).toBe("1:05 PM");
  });

  it("formats 11:59pm", () => {
    expect(fmtTime("2026-08-17T03:59:00Z")).toBe("11:59 PM");
  });

  it("formats 11am (just before noon)", () => {
    expect(fmtTime("2026-08-16T15:00:00Z")).toBe("11:00 AM");
  });

  it("follows DST: the same UTC hour is an hour earlier in winter", () => {
    expect(fmtTime("2026-01-16T11:00:00Z")).toBe("6:00 AM");
  });
});
