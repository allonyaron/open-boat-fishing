import { getOperatorRecord } from "@/lib/operator";

export default async function TermsPage() {
  const operator = await getOperatorRecord();
  const operatorName = operator?.name ?? "Fishing Charter";

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      <header className="bg-white border-b border-hairline h-masthead flex items-center px-5 md:px-8 gap-3">
        <a href="/" className="flex items-center gap-3">
          <div className="w-logo h-logo rounded-icon bg-teal flex items-center justify-center">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2" />
              <path d="M4 20l2-8h12l2 8" />
              <path d="M12 4v8" />
              <path d="M8 8h8" />
            </svg>
          </div>
          <span className="font-grotesk text-17 font-semibold text-ink">{operatorName}</span>
        </a>
      </header>

      <div className="max-w-2xl mx-auto px-5 py-10">
        <h1 className="font-grotesk text-28 font-bold text-ink mb-2">Terms &amp; Conditions</h1>
        <p className="text-13 text-faint mb-8">Last updated January 2025</p>

        <div className="prose prose-sm max-w-none space-y-6 text-15 text-ink leading-relaxed">
          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">
              1. Ticket Purchase
            </h2>
            <p className="text-muted">
              By purchasing tickets through this platform you agree to these terms. All ticket sales
              are final at the time of purchase. Tickets are non-transferable and valid only for the
              specific departure date, time, and vessel shown on your boarding pass.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">
              2. Cancellations &amp; Refunds
            </h2>
            <p className="text-muted mb-2">
              Customer cancellations must be requested at least 48 hours before the scheduled
              departure to receive a full refund. Cancellations inside 48 hours are not eligible for
              a refund.
            </p>
            <p className="text-muted">
              In the event of a trip cancellation due to weather, mechanical issues, or other
              circumstances beyond the operator&apos;s control, a full refund will be issued to the
              original payment method within 5–10 business days. The platform service fee ($1.50 per
              ticket) is refunded in all operator-initiated cancellations.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">3. No-Shows</h2>
            <p className="text-muted">
              Passengers who do not board before departure are considered no-shows and forfeit their
              ticket. No refund will be issued for no-shows.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">
              4. Boarding Requirements
            </h2>
            <p className="text-muted">
              Passengers must arrive at the dock no later than 30 minutes before scheduled
              departure. Bring a valid government-issued photo ID. Your boarding pass (digital or
              printed) must be presented at the gangway. The confirmation email shown at the gangway
              is an accepted fallback if you cannot access your boarding pass.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">
              5. Safety &amp; Conduct
            </h2>
            <p className="text-muted">
              All passengers must follow the instructions of the captain and crew at all times. The
              captain reserves the right to refuse boarding or remove any passenger whose behavior
              is deemed unsafe or disruptive. No refund is given in such cases. Consumption of
              alcohol is at the captain&apos;s discretion.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">6. Liability</h2>
            <p className="text-muted">
              Fishing trips involve inherent risks including but not limited to rough sea
              conditions, adverse weather, and physical activity. Passengers participate at their
              own risk. The operator is not liable for personal injury, loss of property, or illness
              sustained during a trip except in cases of gross negligence.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">
              7. Fishing Regulations
            </h2>
            <p className="text-muted">
              All passengers must comply with applicable federal and state fishing regulations.
              Valid fishing licenses are required where mandated by law. It is the passenger&apos;s
              responsibility to ensure compliance. The operator is not responsible for any
              violations.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">
              8. Platform Service Fee
            </h2>
            <p className="text-muted">
              A $1.50 platform service fee is charged per ticket at the time of purchase. This fee
              covers payment processing and booking platform costs. The fee is included in the
              displayed ticket price.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">9. Privacy</h2>
            <p className="text-muted">
              Your name, email, and phone number are collected to fulfill your booking and send
              trip-related communications. This information is not sold to third parties. Payments
              are processed securely by Stripe; we do not store card details.
            </p>
          </section>

          <section>
            <h2 className="font-grotesk text-18 font-semibold text-ink mb-2">
              10. Changes to Terms
            </h2>
            <p className="text-muted">
              These terms may be updated at any time. Continued use of the booking platform
              constitutes acceptance of the current terms. Questions? Contact us at the email
              provided in your confirmation.
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-hairline">
          <a href="/" className="text-teal text-sm underline">
            ← Back to calendar
          </a>
        </div>
      </div>
    </div>
  );
}
