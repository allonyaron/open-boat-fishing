"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The demo notice as a small tab at the top centre of every page. It is
 * positioned over the header, so it takes no room: pages sit exactly where
 * they would without the demo. Clicking it drops the details down over the
 * page.
 */
export function DemoTab() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);

  // Esc, or a click anywhere outside the tab and its panel, closes it.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      tabRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="demo-tab">
      <button
        ref={tabRef}
        type="button"
        className="demo-tab-btn"
        aria-expanded={open}
        aria-controls="demo-tab-info"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="demo-tab-long">LIVE </span>DEMO
        <span className="demo-tab-long" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div id="demo-tab-info" className="demo-tab-panel" role="region" aria-label="About this demo">
          <p className="demo-tab-title">Live demo</p>
          <p>No real payments. Pay with the test card:</p>
          <p className="demo-tab-card">4242 4242 4242 4242</p>
          <p>Any future date, any CVC. Bookings reset nightly.</p>
          <div className="demo-tab-foot">
            <a href="/admin/login">Admin login →</a>
            <button
              type="button"
              className="demo-tab-close"
              aria-label="Close"
              onClick={() => {
                setOpen(false);
                tabRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
