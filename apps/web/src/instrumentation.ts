// Runs once at server startup (Next.js instrumentation hook).
// Validates required env vars early so missing config fails at boot,
// not mid-request with a cryptic 500.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env");

    // In single-deploy mode OPERATOR_ID pins this instance to one operator row.
    // Validate it exists in the DB at boot so a typo or stale value surfaces
    // immediately rather than producing silent 500s on every request.
    const operatorId = process.env.OPERATOR_ID;
    if (operatorId) {
      const { db } = await import("./lib/db");
      const { operators } = await import("@openboat/db");
      const { eq } = await import("drizzle-orm");
      const [row] = await db
        .select({ id: operators.id })
        .from(operators)
        .where(eq(operators.id, operatorId));
      if (!row) {
        throw new Error(
          `OPERATOR_ID "${operatorId}" not found in the operators table — check your env config`,
        );
      }
    }
  }
}
