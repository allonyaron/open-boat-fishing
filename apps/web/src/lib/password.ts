import { compare, hash } from "bcryptjs";

// Passwords for named accounts. The dummy hash is a real cost-12 bcrypt hash
// (60 characters) of a value nobody knows, so a sign-in for an unknown email
// costs the same as a wrong password (P5-2: a 59-character literal makes
// bcrypt return at once). Row 13 moves the staff and mate logins onto it.

export const DUMMY_HASH = "$2b$12$pyObwUhVONVM2v5b973s/.nqgEqcn.Wen8BCHPJqoJyFD1p/exh3G";

export const PASSWORD_MIN_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

/** Compares against the dummy hash when there is no account, so timing doesn't say which. */
export function checkPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  return compare(password, passwordHash ?? DUMMY_HASH);
}
