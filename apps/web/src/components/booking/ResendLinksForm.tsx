"use client";

import { useState } from "react";

// "Email my link" on the locked booking pages (row 15). The reply never says
// whether a booking was found: the link goes only to the address on the booking.
export function ResendLinksForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/bookings/resend-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(res.status === 429 ? "Too many tries. Try again in a little while." : (data.error ?? "Something went wrong. Try again."));
    } catch {
      setError("Something went wrong. Try again.");
    }
    setState("error");
  }

  if (state === "sent") {
    return (
      <p role="status" className="font-archivo" style={{ fontSize: 16, lineHeight: 1.5, color: "#16354a", maxWidth: "34ch" }}>
        If we have a booking for that address, we&apos;ve emailed its link. Check your inbox, and your spam folder.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-stretch gap-2 w-full" style={{ maxWidth: 340, marginTop: 8 }}>
      <label
        htmlFor="resend-email"
        className="font-plex-mono font-semibold text-left"
        style={{ fontSize: 11, letterSpacing: ".14em", color: "#5b6f79" }}
      >
        EMAIL USED TO BOOK
      </label>
      <input
        id="resend-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="font-archivo"
        style={{ fontSize: 16, padding: "14px 12px", border: "1px solid #9aa8ae", background: "#fff", color: "#16354a" }}
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="font-plex-mono font-semibold"
        style={{ fontSize: 12, letterSpacing: ".1em", background: "#16354a", color: "#fff", padding: "16px 22px", border: "none", cursor: "pointer", opacity: state === "sending" ? 0.6 : 1 }}
      >
        {state === "sending" ? "SENDING…" : "EMAIL MY LINK"}
      </button>
      {error && (
        <p role="alert" className="font-archivo text-left" style={{ fontSize: 14, color: "#b91c1c" }}>
          {error}
        </p>
      )}
    </form>
  );
}
