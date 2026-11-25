import QRCode from "qrcode";

// A QR code drawn on the server as inline SVG. What it encodes can be a
// credential (a boarding-pass link carries its booking key), so it isn't sent
// to a third-party QR image service.
export async function QrSvg({ value, label, className }: { value: string; label: string; className?: string }) {
  const svg = await QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return (
    <div
      role="img"
      aria-label={label}
      className={`[&>svg]:block [&>svg]:w-full [&>svg]:h-full ${className ?? ""}`}
      // The markup comes from the qrcode library, built from `value` as module data, not as HTML.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
