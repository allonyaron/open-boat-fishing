// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DemoTab } from "@/components/DemoTab";

afterEach(cleanup);

const tab = () => screen.getByRole("button", { name: /DEMO/ });
const info = () => screen.queryByRole("region", { name: "About this demo" });

describe("DemoTab", () => {
  it("starts closed and opens the details on click", () => {
    render(<DemoTab />);
    expect(info()).toBeNull();
    expect(tab()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(tab());
    expect(info()).toHaveTextContent("4242 4242 4242 4242");
    expect(tab()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Admin login/ })).toHaveAttribute("href", "/admin/login");
  });

  it("closes on Esc and returns focus to the tab", () => {
    render(<DemoTab />);
    fireEvent.click(tab());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(info()).toBeNull();
    expect(tab()).toHaveFocus();
  });

  it("closes on ×, and on a press outside but not inside", () => {
    render(
      <>
        <DemoTab />
        <p>page</p>
      </>,
    );
    fireEvent.click(tab());
    fireEvent.pointerDown(info()!);
    expect(info()).not.toBeNull();
    fireEvent.pointerDown(screen.getByText("page"));
    expect(info()).toBeNull();

    fireEvent.click(tab());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(info()).toBeNull();
    expect(tab()).toHaveFocus();
  });
});
