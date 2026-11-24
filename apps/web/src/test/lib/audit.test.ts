import { describe, it, expect } from "vitest";
import { changedFields, createdFields } from "@/lib/audit";

describe("changedFields", () => {
  it("keeps only the fields that changed, and leaves updatedAt out", () => {
    expect(
      changedFields(
        { name: "Old", phone: "1", capacity: 20, updatedAt: new Date(0) },
        { name: "New", phone: "1", updatedAt: new Date() },
      ),
    ).toEqual({ before: { name: "Old" }, after: { name: "New" } });
  });

  it("compares arrays and dates by value", () => {
    expect(
      changedFields({ days: ["mon", "tue"], at: new Date(5) }, { days: ["mon", "tue"], at: new Date(5) }),
    ).toEqual({ before: {}, after: {} });
    expect(changedFields({ at: new Date(5) }, { at: new Date(6) }).after).toEqual({ at: new Date(6).toISOString() });
  });

  it("records a password or PIN only as changed", () => {
    expect(changedFields({ passwordHash: "$2b$old", pinHash: null }, { passwordHash: "$2b$new", pinHash: "$2b$pin" })).toEqual({
      before: { passwordHash: "[secret]", pinHash: null },
      after: { passwordHash: "[secret]", pinHash: "[secret]" },
    });
    expect(createdFields({ name: "Ann", pinHash: "$2b$pin" })).toEqual({ name: "Ann", pinHash: "[secret]" });
  });
});
