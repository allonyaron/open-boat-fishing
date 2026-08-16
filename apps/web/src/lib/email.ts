import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

type TicketLine = {
  ticketType: string;
  count: number;
  priceCents: number;
  tripDate: string;
  vesselName: string;
  productName: string;
  departs: string;
  returns: string;
};

type BookingEmailParams = {
  to: string;
  customerName: string | null;
  confirmationCode: string;
  bookingId: string;
  totalCents: number;
  ticketLines: TicketLine[];
  fromAddress: string;
  appUrl: string;
};

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildHtml(p: BookingEmailParams): string {
  const boardingUrl = `${p.appUrl}/boarding/${p.bookingId}`;

  const ticketRows = p.ticketLines
    .map(
      (t) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
        ${capitalize(t.ticketType)} × ${t.count} — ${t.vesselName} (${t.productName})
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;">
        ${t.tripDate}<br>
        <span style="color:#6b7280;font-size:12px;">${t.departs} → ${t.returns}</span>
      </td>
      <td style="padding:10px 0 10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;">
        ${fmt(t.priceCents * t.count)}
      </td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <tr>
          <td style="background:#1e3a5f;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
              Tickets Purchased
            </h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:14px;">
              Confirmation #${p.confirmationCode}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 20px;font-size:15px;color:#374151;">
              Hi${p.customerName ? ` ${p.customerName}` : ""}, your tickets are confirmed!
            </p>

            <!-- Ticket list -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              ${ticketRows}
              <tr>
                <td colspan="2" style="padding:14px 0 0;font-size:15px;font-weight:700;color:#111827;">
                  Total
                </td>
                <td style="padding:14px 0 0 16px;font-size:15px;font-weight:700;color:#111827;text-align:right;white-space:nowrap;">
                  ${fmt(p.totalCents)}
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr>
                <td style="background:#1e3a5f;border-radius:6px;">
                  <a href="${boardingUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                    View &amp; Print Boarding Passes →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Fallback note -->
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;border-top:1px solid #e5e7eb;padding-top:20px;">
              If you have trouble printing your boarding pass, <strong>this email is sufficient for boarding</strong> —
              just show it at the gangway. Your confirmation number is <strong>#${p.confirmationCode}</strong>.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f3f4f6;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              Questions? Reply to this email or call us before your departure.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendOtpEmail(params: {
  to: string;
  otp: string;
  operatorName: string;
  fromAddress: string;
}): Promise<void> {
  const { error } = await getResend().emails.send({
    from: params.fromAddress,
    to: params.to,
    subject: `Your sign-in code: ${params.otp}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="margin-bottom:8px">${params.operatorName}</h2>
        <p style="color:#555;margin-bottom:24px">Use this code to sign in to your account:</p>
        <div style="font-size:40px;font-weight:800;letter-spacing:12px;color:#0E7C7B;text-align:center;padding:24px;background:#f5f5f5;border-radius:12px;margin-bottom:24px">
          ${params.otp}
        </div>
        <p style="color:#888;font-size:13px">This code expires in 15 minutes and can only be used once.</p>
      </div>
    `,
  });
  if (error) throw new Error(`Resend OTP error: ${error.message}`);
}

export async function sendBookingConfirmation(p: BookingEmailParams): Promise<void> {
  const subject = `Tickets Purchased – Confirmation #${p.confirmationCode}`;
  const html = buildHtml(p);

  const { error } = await getResend().emails.send({
    from: p.fromAddress,
    to: p.to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
