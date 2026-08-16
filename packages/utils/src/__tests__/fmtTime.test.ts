import { describe, it, expect } from "vitest";
import { fmtTime } from "../index";

describe("fmtTime", () => {
  it("formats midnight as 12 AM", () => {
    expect(fmtTime("2026-08-16T00:00:00")).toBe("12 AM");
  });

  it("formats noon as 12 PM", () => {
    expect(fmtTime("2026-08-16T12:00:00")).toBe("12 PM");
  });

  it("formats 7am on the hour", () => {
    expect(fmtTime("2026-08-16T07:00:00")).toBe("7 AM");
  });

  it("formats 7:30am with minutes", () => {
    expect(fmtTime("2026-08-16T07:30:00")).toBe("7:30 AM");
  });

  it("formats 1pm", () => {
    expect(fmtTime("2026-08-16T13:00:00")).toBe("1 PM");
  });

  it("formats 1:05pm (zero-padded minutes)", () => {
    expect(fmtTime("2026-08-16T13:05:00")).toBe("1:05 PM");
  });

  it("formats 11:59pm", () => {
    expect(fmtTime("2026-08-16T23:59:00")).toBe("11:59 PM");
  });

  it("formats 11am (just before noon)", () => {
    expect(fmtTime("2026-08-16T11:00:00")).toBe("11 AM");
  });
});
