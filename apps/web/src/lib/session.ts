import { and, eq } from "drizzle-orm";
import { staff } from "@openboat/db";
import { db } from "@/lib/db";
import { makeSession } from "@/lib/session-factory";

export type SessionData = {
  staffId: string;
  operatorId: string;
  role: "admin" | "mate";
  name: string;
  /** staff.session_version at sign-in; a deactivation or new password ends the session. */
  sessionVersion: number;
};

const { getSession, requireSession: requireAdmin } = makeSession<SessionData>({
  cookieName: "openboat_admin",
  maxAge: 60 * 60 * 8, // 8 hours
  // Every admin request re-checks the account (row 12, P5-1, F1-8): the
  // session is for this host's operator (a missing header is a mismatch),
  // and the staff row still exists, is an active admin, and has the version
  // the session was issued with. One indexed read per request.
  authorize: async (s, req) => {
    if (!s.staffId || !s.operatorId || s.role !== "admin" || typeof s.sessionVersion !== "number") {
      return null;
    }
    const hostOperatorId = req.headers.get("x-operator-id");
    if (!hostOperatorId || hostOperatorId !== s.operatorId) return null;

    const [member] = await db
      .select({
        active: staff.active,
        role: staff.role,
        name: staff.name,
        sessionVersion: staff.sessionVersion,
      })
      .from(staff)
      .where(and(eq(staff.id, s.staffId), eq(staff.operatorId, s.operatorId)));
    if (!member || !member.active || member.role !== "admin" || member.sessionVersion !== s.sessionVersion) {
      return null;
    }
    s.name = member.name;
    return { kind: "staff", staffId: s.staffId, operatorId: s.operatorId, role: "admin" };
  },
});

export { getSession, requireAdmin };
