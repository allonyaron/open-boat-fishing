import { makeSession } from "@/lib/session-factory";

export type SessionData = {
  staffId: string;
  operatorId: string;
  role: "admin" | "mate";
  name: string;
};

const { getSession, requireSession: requireAdmin } = makeSession<SessionData>({
  cookieName: "openboat_admin",
  maxAge: 60 * 60 * 8, // 8 hours
  isAuthorized: (s) => !!s.staffId && s.role === "admin",
});

export { getSession, requireAdmin };
