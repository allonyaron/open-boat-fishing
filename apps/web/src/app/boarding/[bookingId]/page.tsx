import { db } from "@/lib/db";
import { bookings, bookingItems, tickets, trips, products, vessels, operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PrintButton } from "./PrintButton";

export default async function BoardingPassPage({ params }: { params: { bookingId: string } }) {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, params.bookingId));

  if (!booking) notFound();

  const [operator] = await db
    .select({
      name: operators.name,
      phone: operators.phone,
      dockAddress: operators.dockAddress,
      dockMapsUrl: operators.dockMapsUrl,
      termsUrl: operators.termsUrl,
    })
    .from(operators)
    .limit(1);
  const operatorName = operator?.name ?? "Fishing Charter";

  const ticketRows = await db
    .select({
      id: tickets.id,
      ticketType: tickets.ticketType,
      priceCents: tickets.priceCents,
      qrPayload: tickets.qrPayload,
      passengerName: tickets.passengerName,
      voided: tickets.voided,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      boardingTime: trips.boardingTime,
      tripStatus: trips.status,
      vesselName: vessels.name,
      vesselColor: vessels.color,
      productName: products.displayName,
      category: products.category,
    })
    .from(tickets)
    .innerJoin(bookingItems, eq(bookingItems.id, tickets.bookingItemId))
    .innerJoin(trips, eq(trips.id, bookingItems.tripId))
    .innerJoin(vessels, eq(vessels.id, trips.vesselId))
    .innerJoin(products, eq(products.id, trips.productId))
    .where(eq(tickets.bookingId, booking.id))
    .orderBy(trips.departureDate, trips.startTime);

  if (ticketRows.length === 0) notFound();

  function fmtDate(d: string) {
    return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function fmtTime(iso: Date | string) {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  }

  function capitalize(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function fmtBoardingTime(t: string | null) {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    const suffix = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
  }

  const qrBaseUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=`;

  return (
    <>
      {/* Print button — hidden when printing */}
      <div className="no-print bg-gray-100 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0E7C7B] flex items-center justify-center">
            <svg
              width="16"
              height="16"
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
          <div>
            <div className="font-semibold text-sm text-gray-900">
              {operatorName} — Boarding Passes
            </div>
            <div className="text-xs text-gray-500">
              Confirmation: {booking.confirmationCode} · {ticketRows.length} ticket
              {ticketRows.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <PrintButton />
      </div>

      {/* One ticket per page */}
      {ticketRows.map((ticket, i) => {
        const cancelled =
          ticket.voided || booking.status === "cancelled" || ticket.tripStatus === "cancelled";
        return (
          <div
            key={ticket.id}
            className="ticket-page font-sans"
            style={{ pageBreakAfter: i < ticketRows.length - 1 ? "always" : "auto" }}
          >
            {cancelled && (
              <div
                style={{
                  background: "#B91C1C",
                  color: "white",
                  textAlign: "center",
                  padding: "0.5rem",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  fontSize: "0.75rem",
                }}
              >
                CANCELLED — THIS TICKET IS NO LONGER VALID
              </div>
            )}
            {/* Header bar — color-coded to vessel */}
            <div
              className="ticket-header"
              style={{ backgroundColor: cancelled ? "#6B7280" : ticket.vesselColor }}
            >
              <div className="ticket-header-left">
                <div className="ticket-operator">{operatorName.toUpperCase()} TICKETS</div>
                <div className="ticket-vessel">{ticket.vesselName}</div>
              </div>
              <div className="ticket-header-right">
                <img
                  src={`${qrBaseUrl}${encodeURIComponent(ticket.qrPayload)}`}
                  alt={`QR code for ticket ${ticket.id}`}
                  width={100}
                  height={100}
                  className="ticket-qr"
                />
              </div>
            </div>

            {/* Body */}
            <div className="ticket-body">
              <div className="ticket-body-main">
                {/* Boarding pass label + type */}
                <div className="ticket-label">BOARDING PASS</div>
                <div className="ticket-type">{capitalize(ticket.ticketType)} Ticket</div>

                {/* Trip details */}
                <div className="ticket-section-label">TRIP</div>
                <div className="ticket-trip-name">
                  {ticket.category} — {ticket.productName}
                </div>

                <div className="ticket-row">
                  <div>
                    <div className="ticket-section-label">DATE</div>
                    <div className="ticket-value">{fmtDate(ticket.departureDate)}</div>
                  </div>
                </div>

                <div className="ticket-row">
                  <div>
                    <div className="ticket-section-label">DEPARTURE</div>
                    <div className="ticket-value">{fmtTime(ticket.startTime)}</div>
                  </div>
                  <div>
                    <div className="ticket-section-label">RETURN</div>
                    <div className="ticket-value">{fmtTime(ticket.endTime)}</div>
                  </div>
                  {fmtBoardingTime(ticket.boardingTime) && (
                    <div>
                      <div className="ticket-section-label">BE AT THE BOAT BY</div>
                      <div className="ticket-value">{fmtBoardingTime(ticket.boardingTime)}</div>
                    </div>
                  )}
                </div>

                {operator?.dockAddress && (
                  <div className="ticket-row">
                    <div>
                      <div className="ticket-section-label">DOCK LOCATION</div>
                      <div className="ticket-value">
                        {operator.dockMapsUrl ? (
                          <a
                            href={operator.dockMapsUrl}
                            style={{ color: "#0E7C7B", textDecoration: "underline" }}
                          >
                            {operator.dockAddress}
                          </a>
                        ) : (
                          operator.dockAddress
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="ticket-row">
                  <div>
                    <div className="ticket-section-label">PURCHASED BY</div>
                    <div className="ticket-value">{booking.customerName}</div>
                  </div>
                  <div>
                    <div className="ticket-section-label">CONFIRMATION</div>
                    <div className="ticket-value ticket-code">{booking.confirmationCode}</div>
                  </div>
                </div>

                {/* Footer notice */}
                <div className="ticket-notice">
                  This ticket is sufficient for boarding. Show at the gangway. If you have trouble
                  printing, your confirmation email is also accepted.
                  {operator?.phone && (
                    <>
                      {" "}
                      Questions? Call <strong>{operator.phone}</strong>.
                    </>
                  )}
                  {operator?.termsUrl && (
                    <>
                      {" "}
                      <a href={operator.termsUrl} style={{ color: "#0E7C7B" }}>
                        Weather &amp; cancellation policy
                      </a>
                      .
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Ticket ID footer */}
            <div className="ticket-footer">
              <span className="ticket-id">{ticket.id}</span>
              <span>
                Ticket {i + 1} of {ticketRows.length}
              </span>
            </div>
          </div>
        );
      })}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }

        .ticket-page {
          width: 8.5in;
          min-height: 5.5in;
          margin: 0 auto 2rem auto;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 24px rgba(0,0,0,0.08);
        }

        @media print {
          .ticket-page {
            width: 100%;
            min-height: 100vh;
            margin: 0;
            border: none;
            border-radius: 0;
            box-shadow: none;
            page-break-after: always;
          }
        }

        .ticket-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.25rem 1.5rem;
          color: white;
        }

        .ticket-header-left { flex: 1; }

        .ticket-operator {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0.85;
          margin-bottom: 0.25rem;
        }

        .ticket-vessel {
          font-size: 1.5rem;
          font-weight: 800;
          letter-spacing: -0.01em;
        }

        .ticket-qr {
          border-radius: 8px;
          background: white;
          padding: 6px;
        }

        .ticket-body {
          flex: 1;
          padding: 1.5rem;
        }

        .ticket-body-main {
          max-width: 6in;
        }

        .ticket-label {
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #8A9998;
          margin-bottom: 0.15rem;
        }

        .ticket-type {
          font-size: 1.75rem;
          font-weight: 800;
          color: #10201F;
          margin-bottom: 1.25rem;
          letter-spacing: -0.02em;
        }

        .ticket-section-label {
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #8A9998;
          margin-bottom: 0.2rem;
        }

        .ticket-trip-name {
          font-size: 1rem;
          font-weight: 600;
          color: #10201F;
          margin-bottom: 1rem;
        }

        .ticket-row {
          display: flex;
          gap: 2.5rem;
          margin-bottom: 1rem;
        }

        .ticket-value {
          font-size: 1rem;
          font-weight: 600;
          color: #10201F;
        }

        .ticket-code {
          font-size: 1.25rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          color: #0E7C7B;
        }

        .ticket-notice {
          margin-top: 1.25rem;
          padding: 0.75rem 1rem;
          background: #F4F6F6;
          border-radius: 8px;
          font-size: 0.75rem;
          color: #56676A;
          line-height: 1.5;
        }

        .ticket-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.6rem 1.5rem;
          border-top: 1px solid #ECEFEE;
          background: #F9FAFA;
        }

        .ticket-id {
          font-family: monospace;
          font-size: 0.65rem;
          color: #8A9998;
        }

        .ticket-footer span:last-child {
          font-size: 0.7rem;
          font-weight: 600;
          color: #56676A;
        }
      `}</style>
    </>
  );
}
