import { db } from "@/lib/db";
import { bookings, operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: { code?: string; email?: string; phone?: string; redirect_status?: string };
}) {
  const { code, email, phone, redirect_status } = searchParams;

  if (!code) notFound();

  if (redirect_status !== "succeeded") {
    redirect(`/booking/confirmation?code=${code}&redirect_status=${redirect_status ?? ""}`);
  }

  const [booking] = await db.select().from(bookings).where(eq(bookings.confirmationCode, code));
  if (!booking) notFound();

  const [operator] = await db.select({ name: operators.name }).from(operators).limit(1);
  const operatorName = operator?.name ?? "Fishing Charter";

  const displayEmail = email ?? booking.customerEmail;
  const displayPhone = phone ?? booking.customerPhone ?? "";

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      <header className="bg-white border-b border-hairline h-[66px] flex items-center px-5 md:px-8 gap-3">
        <a href="/" className="flex items-center gap-3">
          <div className="w-[34px] h-[34px] rounded-[10px] bg-teal flex items-center justify-center">
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
          <span className="font-grotesk text-[17px] font-semibold text-ink">{operatorName}</span>
        </a>
      </header>

      <div className="max-w-lg mx-auto px-5 py-10">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🎣</div>
          <h1 className="font-grotesk text-[26px] font-semibold text-ink mb-2">
            You&apos;re booked!
          </h1>
          <p className="text-muted text-[15px]">How would you like your tickets?</p>
        </div>

        <div className="space-y-3 mb-8">
          {/* Print */}
          <a
            href={`/boarding/${booking.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 bg-white rounded-card border border-card-border p-5 hover:border-teal/40 hover:shadow-card transition-all group"
          >
            <div className="w-11 h-11 rounded-[12px] bg-teal-tint flex items-center justify-center flex-shrink-0">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0E7C7B"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect width="12" height="8" x="6" y="14" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-grotesk text-[15px] font-semibold text-ink">Print tickets</div>
              <div className="text-[13px] text-muted">
                Open your boarding passes to print or save as PDF
              </div>
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-faint group-hover:text-muted transition-colors"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </a>

          {/* Email */}
          <div className="flex items-center gap-4 bg-white rounded-card border border-card-border p-5">
            <div className="w-11 h-11 rounded-[12px] bg-success-bg flex items-center justify-center flex-shrink-0">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#22C55E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-grotesk text-[15px] font-semibold text-ink">Email tickets</div>
              <div className="text-[13px] text-muted truncate">
                Confirmation sent to {displayEmail}
              </div>
            </div>
          </div>

          {/* Text — only if a phone number was provided */}
          {displayPhone && (
            <div className="flex items-center gap-4 bg-white rounded-card border border-card-border p-5">
              <div className="w-11 h-11 rounded-[12px] bg-teal-tint flex items-center justify-center flex-shrink-0">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0E7C7B"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="14" height="20" x="5" y="2" rx="2" />
                  <path d="M12 18h.01" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-grotesk text-[15px] font-semibold text-ink">Text updates</div>
                <div className="text-[13px] text-muted">{displayPhone}</div>
              </div>
            </div>
          )}
        </div>

        <a
          href={`/booking/confirmation?code=${code}`}
          className="block w-full text-center py-4 rounded-btn bg-teal text-white font-grotesk font-semibold hover:bg-teal-hover transition-colors"
        >
          View booking details
        </a>

        <a
          href="/"
          className="block text-center text-[13px] text-muted mt-4 hover:text-ink underline transition-colors"
        >
          Back to calendar
        </a>
      </div>
    </div>
  );
}
