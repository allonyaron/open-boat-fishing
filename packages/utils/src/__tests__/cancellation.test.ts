import { describe, it, expect } from "vitest";
import { cancellationTerms, freeCancellationLine, freeCancellationSentence } from "../cancellation";

describe("cancellation wording", () => {
  it("says the operator's window the same way everywhere", () => {
    expect(freeCancellationLine(48)).toBe("FREE CANCELLATION TO 48H BEFORE SAILING");
    expect(freeCancellationSentence(48)).toBe("Cancel free until 48h before sailing.");
    expect(cancellationTerms(48)).toBe(
      "Customer cancellations must be requested at least 48 hours before the scheduled departure to receive a full refund. Cancellations inside 48 hours are not eligible for a refund.",
    );
  });

  it("follows another window", () => {
    expect(freeCancellationLine(24)).toBe("FREE CANCELLATION TO 24H BEFORE SAILING");
    expect(cancellationTerms(1)).toMatch(/at least 1 hour before/);
  });

  it("allows cancelling up to sailing when the window is 0", () => {
    expect(freeCancellationLine(0)).toBe("FREE CANCELLATION TO SAILING");
    expect(freeCancellationSentence(0)).toBe("Cancel free until sailing.");
    expect(cancellationTerms(0)).toMatch(/before the scheduled departure receive a full refund/);
  });
});
