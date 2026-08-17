import { describe, it, expect } from "vitest";
import { dollars } from "../index";

describe("dollars", () => {
  it("formats whole dollars without decimals", () => {
    expect(dollars(10000)).toBe("$100");
  });

  it("formats zero cents", () => {
    expect(dollars(0)).toBe("$0");
  });

  it("formats a single dollar", () => {
    expect(dollars(100)).toBe("$1");
  });

  it("formats cents with two decimal places", () => {
    expect(dollars(1050)).toBe("$10.50");
  });

  it("formats odd cents", () => {
    expect(dollars(9999)).toBe("$99.99");
  });

  it("always includes dollar sign", () => {
    expect(dollars(500).startsWith("$")).toBe(true);
  });
});
