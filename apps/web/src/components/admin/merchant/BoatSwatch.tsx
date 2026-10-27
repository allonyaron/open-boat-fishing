/**
 * A boat's colour bar. The colour is the boat's saved value (shared with the
 * public site, so often dark); the 1px control-coloured outline keeps dark
 * colours visible on the Console theme. Always sits next to the boat's name —
 * nothing depends on the colour alone.
 */
export function BoatSwatch({
  color,
  size = "md",
  muted = false,
}: {
  color: string;
  /** md 16×4 (rows), sm 14×4 (tables), xs 10×4 (calendar chips), lg 20×5 (group headers). */
  size?: "xs" | "sm" | "md" | "lg";
  /** Cancelled: grey instead of the boat colour. */
  muted?: boolean;
}) {
  const dims = size === "xs" ? "w-2.5 h-1" : size === "sm" ? "w-3.5 h-1" : size === "lg" ? "w-5 h-[5px]" : "w-4 h-1";
  return (
    <span
      aria-hidden="true"
      className={`inline-block flex-none ${dims} shadow-[0_0_0_1px_var(--ob-control)] ${muted ? "bg-ob-ink-3" : ""}`}
      style={muted ? undefined : { backgroundColor: color }}
    />
  );
}
