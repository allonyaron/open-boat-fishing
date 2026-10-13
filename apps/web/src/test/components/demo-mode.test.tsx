// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// DEMO_MODE as each test sets it.
const env = vi.hoisted(() => ({ DEMO_MODE: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env }));

// CheckoutForm needs Stripe's Elements context; the hint doesn't.
vi.mock("@stripe/react-stripe-js", () => ({
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import { DemoBanner } from "@/components/DemoBanner";
import { CheckoutForm } from "@/app/checkout/CheckoutForm";
import type { WebCartLine } from "@/lib/cart/store";

afterEach(cleanup);

describe("DemoBanner (the demo tab's switch)", () => {
  it("shows the tab only when DEMO_MODE is \"true\"", () => {
    for (const value of [undefined, "false", "1", ""]) {
      env.DEMO_MODE = value;
      expect(DemoBanner()).toBeNull();
    }
    env.DEMO_MODE = "true";
    render(<>{DemoBanner()}</>);
    expect(screen.getByRole("button", { name: /DEMO/ })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("checkout test-card hint", () => {
  const line: WebCartLine = {
    trip: {
      id: "trip-1",
      departureDate: "2026-11-14",
      startTime: "2026-11-14T10:00:00.000Z",
      endTime: "2026-11-14T19:00:00.000Z",
      capacity: 40,
      seatsRemaining: 30,
      vessel: { name: "MV Open Boat II", color: "#0087A8", code: null },
      product: {
        category: "Blackfish",
        displayName: "Full-Day Blackfish",
        showRemaining: true,
        prices: [{ ticketType: "adult", priceCents: 9900 }],
      },
    },
    quantities: { adult: 1 },
  };
  const quote = { status: "loading" as const, previous: null, refresh: () => {} };
  const hint = () => screen.queryByText(/^Demo: no real payment/);

  it("shows the test card above the payment form in demo mode", () => {
    render(<CheckoutForm lines={[line]} quote={quote} demoMode />);
    expect(hint()).toBeInTheDocument();
    expect(hint()).toHaveTextContent("4242 4242 4242 4242");
  });

  it("is absent otherwise", () => {
    render(<CheckoutForm lines={[line]} quote={quote} />);
    expect(hint()).toBeNull();
  });
});
