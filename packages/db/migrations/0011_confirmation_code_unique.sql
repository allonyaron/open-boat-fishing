-- 0000 already creates this constraint, so on a fresh database the bare
-- ADD CONSTRAINT failed and no migration after 0010 could run. Guarded so it
-- only adds the constraint where it's missing. (The migrator tracks applied
-- migrations by timestamp, not hash, so databases past 0011 are unaffected.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_confirmation_code_unique'
  ) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmation_code_unique" UNIQUE("confirmation_code");
  END IF;
END $$;
