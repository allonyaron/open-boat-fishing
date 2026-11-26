// The customer cancellation window, in words. The window itself lives in one
// place, the operator's setting (operators.cancel_window_hrs, default 48,
// edited under admin Settings); every page and app screen passes that number
// here, so they all say the same thing.

/** "48h before sailing", or "sailing" when the operator allows cancelling right up to it. */
function until(hours: number): string {
  return hours > 0 ? `${hours}h before sailing` : "sailing";
}

/** The short trust line, upper case: "FREE CANCELLATION TO 48H BEFORE SAILING". */
export function freeCancellationLine(hours: number): string {
  return `Free cancellation to ${until(hours)}`.toUpperCase();
}

/** One sentence: "Cancel free until 48h before sailing." */
export function freeCancellationSentence(hours: number): string {
  return `Cancel free until ${until(hours)}.`;
}

/** The terms page's rule, in full. */
export function cancellationTerms(hours: number): string {
  if (hours <= 0) {
    return "Customer cancellations requested before the scheduled departure receive a full refund.";
  }
  const span = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return (
    `Customer cancellations must be requested at least ${span} before the scheduled departure to ` +
    `receive a full refund. Cancellations inside ${span} are not eligible for a refund.`
  );
}
