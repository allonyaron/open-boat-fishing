"use client";

import { useState, useEffect } from "react";
import { dollars } from "@openboat/utils";

function ArrowRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function ContactOverlay({
  totalCents,
  ticketCount,
  onSubmit,
  onClose,
}: {
  totalCents: number;
  ticketCount: number;
  onSubmit: (name: string, email: string, phone: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-overlay-title"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl animate-slide-up md:left-1/2 md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:w-[440px] md:rounded-3xl md:max-h-[90vh] md:overflow-y-auto"
      >
        <div className="flex justify-center pt-3 pb-1 md:hidden" aria-hidden="true">
          <div className="w-10 h-1 rounded-pill bg-hairline" />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(name.trim(), email.trim(), phone.trim());
          }}
          className="px-5 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] md:pb-6"
        >
          <div className="hidden md:flex items-center justify-between mb-5">
            <div id="contact-overlay-title" className="font-grotesk text-20 font-semibold text-ink">Your details</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-pill hover:bg-fill flex items-center justify-center text-muted"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div className="mb-5 md:hidden">
            <div className="font-grotesk text-20 font-semibold text-ink">Your details</div>
            <div className="text-13 text-muted mt-1">
              {ticketCount} ticket{ticketCount !== 1 ? "s" : ""} · {dollars(totalCents)}
            </div>
          </div>
          <div className="hidden md:flex items-center justify-between mb-4 p-3 bg-fill rounded-xl">
            <span className="text-13 text-muted">
              {ticketCount} ticket{ticketCount !== 1 ? "s" : ""}
            </span>
            <span className="font-grotesk text-18 font-bold text-ink">
              {dollars(totalCents)}
            </span>
          </div>
          <div className="space-y-3">
            {[
              {
                id: "contact-name",
                label: "Full name",
                value: name,
                setter: setName,
                type: "text",
                autoComplete: "name",
                inputMode: undefined,
                placeholder: "Jane Smith",
                required: true,
              },
              {
                id: "contact-email",
                label: "Email",
                value: email,
                setter: setEmail,
                type: "email",
                autoComplete: "email",
                inputMode: undefined,
                placeholder: "jane@example.com",
                required: true,
              },
              {
                id: "contact-phone",
                label: "Mobile (for text updates)",
                value: phone,
                setter: setPhone,
                type: "tel",
                autoComplete: "tel",
                inputMode: "numeric" as const,
                placeholder: "(555) 000-0000",
                required: false,
              },
            ].map(
              ({ id, label, value, setter, type, autoComplete, inputMode, placeholder, required }) => (
                <div key={id}>
                  <label
                    htmlFor={id}
                    className="text-11 font-bold uppercase tracking-wide text-faint block mb-1.5"
                  >
                    {label}
                  </label>
                  <input
                    id={id}
                    required={required}
                    type={type}
                    autoComplete={autoComplete}
                    inputMode={inputMode}
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-4 py-3 rounded-xl border border-card-border text-15 text-ink placeholder:text-faint focus:outline-none focus:border-gold transition-colors"
                  />
                </div>
              ),
            )}
          </div>
          <p className="text-11 text-faint text-center mt-5">
            Purchasing tickets means you accept the{" "}
            <a href="/terms" className="underline text-gold">
              terms and conditions
            </a>
            .
          </p>
          <button
            type="submit"
            className="mt-3 w-full py-4 rounded-btn font-grotesk text-15 font-semibold bg-gold text-navy hover:bg-gold-hover transition-colors flex items-center justify-center gap-2"
          >
            Continue to payment <ArrowRight />
          </button>
        </form>
      </div>
    </>
  );
}
