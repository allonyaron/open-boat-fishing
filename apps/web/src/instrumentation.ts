// Runs once at server startup (Next.js instrumentation hook).
// Validates required env vars early so missing config fails at boot,
// not mid-request with a cryptic 500.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env");
  }
}
