-- Table and column descriptions for the data dictionary (docs/schema/, generated
-- by tbls). Comments only: no schema change, safe for the running code.
COMMENT ON TABLE "operators" IS 'One row per fishing boat business (tenant root). A single-deploy install has exactly one row; the centralized platform has one per operator, resolved from the request hostname via domains.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."slug" IS 'URL-safe unique identifier.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."stripe_account_id" IS 'Stripe Connect connected account. Destination charges transfer ticket revenue here.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."stripe_onboarding_complete" IS 'True once the operator has finished Stripe Connect onboarding and can take payments.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."email_from" IS 'Sender address for customer emails, e.g. office@youroperator.com.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."email_domain" IS 'Domain the sender address belongs to, e.g. youroperator.com.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."twilio_from_number" IS 'SMS sender number. Null = SMS not configured.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."terms_url" IS 'Link to the operator''s terms and conditions shown at checkout.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."dock_address" IS 'Where passengers board, shown on confirmations and boarding passes.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."dock_maps_url" IS 'Map link for the dock.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."arrive_minutes_before" IS 'How early passengers should arrive. Null = no arrive-early note shown.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."fee_bearer" IS 'Who pays the per-ticket platform fee: passenger (added to the ticket price) or operator (absorbed).';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."fee_display" IS 'How the platform fee is shown: itemized as a separate line, or folded into the ticket price.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."cancel_window_hrs" IS 'How many hours before departure a customer can still self-cancel.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."settle_grace_hrs" IS 'Hours after departure before ticket fees move from held to earned.';
--> statement-breakpoint
COMMENT ON COLUMN "operators"."online_cutoff_minutes" IS 'Online sales stop this many minutes before departure. 0 = sales run right up to departure. A trip can override it with trips.online_cutoff_minutes.';
--> statement-breakpoint
COMMENT ON TABLE "domains" IS 'Hostname to operator mapping used by the Edge middleware in platform mode. An operator may have several domains.';
--> statement-breakpoint
COMMENT ON COLUMN "domains"."domain" IS 'Hostname, e.g. youroperator.com.';
--> statement-breakpoint
COMMENT ON COLUMN "domains"."primary" IS 'The operator''s canonical domain.';
--> statement-breakpoint
COMMENT ON TABLE "vessels" IS 'Boats owned by an operator.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."color" IS 'Hex colour used to tell vessels apart in the UI, e.g. #1D4ED8.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."code" IS 'Short display code, e.g. LLX.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."capacity" IS 'Passenger capacity.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."certificate_capacity" IS 'Legal maximum passengers from the vessel''s certificate. Null = not configured.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."active" IS 'False = vessel retired. Inactive vessels are left out of admin pickers.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."group_discount_threshold" IS 'Tickets on this vessel in one booking needed to trigger the group discount. Null = disabled.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."group_discount_pct" IS 'Percent taken off qualifying tickets when the group discount applies.';
--> statement-breakpoint
COMMENT ON TABLE "products" IS 'Trip type sold on a vessel, e.g. Sea Bass Fishing Express.';
--> statement-breakpoint
COMMENT ON COLUMN "products"."category" IS 'Fish species label, e.g. Sea Bass, Fluke, Night Stripers.';
--> statement-breakpoint
COMMENT ON COLUMN "products"."display_name" IS 'Full name shown to customers, e.g. Sea Bass Fishing Express.';
--> statement-breakpoint
COMMENT ON COLUMN "products"."what_to_bring" IS 'Checklist shown to passengers before the trip.';
--> statement-breakpoint
COMMENT ON COLUMN "products"."show_remaining" IS 'Show customers how many seats are left.';
--> statement-breakpoint
COMMENT ON TABLE "product_prices" IS 'Default price per ticket type for a product. Adult, child and senior each get a row.';
--> statement-breakpoint
COMMENT ON COLUMN "product_prices"."price_cents" IS 'Ticket price in cents, e.g. 6800 = $68.00.';
--> statement-breakpoint
COMMENT ON TABLE "schedules" IS 'Recurring departure pattern for a product. Trips are materialized from it when it is saved.';
--> statement-breakpoint
COMMENT ON COLUMN "schedules"."start_date" IS 'First date the pattern runs (inclusive).';
--> statement-breakpoint
COMMENT ON COLUMN "schedules"."end_date" IS 'Last date the pattern runs (inclusive).';
--> statement-breakpoint
COMMENT ON COLUMN "schedules"."days_of_week" IS 'Days the trip runs.';
--> statement-breakpoint
COMMENT ON COLUMN "schedules"."departure_time" IS 'Local departure time.';
--> statement-breakpoint
COMMENT ON COLUMN "schedules"."return_time" IS 'Local return time. Trips usually last 4 to 5 hours and can end after midnight.';
--> statement-breakpoint
COMMENT ON COLUMN "schedules"."capacity" IS 'Seats per trip. Can differ from the vessel default.';
--> statement-breakpoint
COMMENT ON TABLE "schedule_prices" IS 'Per-schedule price overrides. Take precedence over product_prices at booking time, which enables weekday vs. weekend pricing through separate schedules. Falls back to product_prices when no row exists.';
--> statement-breakpoint
COMMENT ON COLUMN "schedule_prices"."price_cents" IS 'Ticket price in cents.';
--> statement-breakpoint
COMMENT ON TABLE "holiday_dates" IS 'Dates meant to be priced as weekend/holiday regardless of day of week (e.g. Labor Day, July 4th). Not yet read by booking or pricing.';
--> statement-breakpoint
COMMENT ON COLUMN "holiday_dates"."label" IS 'Display name, e.g. Labor Day 2026.';
--> statement-breakpoint
COMMENT ON TABLE "trips" IS 'One materialized departure. Written when a schedule is saved, or added by hand as a one-off. (schedule_id, departure_date) is unique.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."schedule_id" IS 'Schedule that generated this trip. Null = one-off departure added by hand.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."departure_date" IS 'Local calendar date of departure.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."start_time" IS 'Departure instant.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."end_time" IS 'Return instant. Can fall on the next calendar day.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."capacity" IS 'Total seats on this trip.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."seats_remaining" IS 'Unsold seats. Change only with SQL arithmetic inside a FOR UPDATE transaction, never read-check-write.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."status" IS 'scheduled (bookable) -> pending_settlement (departed, inside the grace window) -> sailed (fees earned), or cancelled (fees reversed).';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."sailed_at" IS 'When the trip moved to sailed.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."cancelled_at" IS 'When the trip was cancelled.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."cancellation_reason" IS 'weather, mechanical, low_bookings, or free text.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."boarding_time" IS 'Boarding time when it differs from departure, e.g. board 06:30, depart 07:00.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."duration_day" IS 'Whole days of a multi-day trip. 0 for same-day trips.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."duration_hr" IS 'Hours part of the trip duration.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."duration_min" IS 'Minutes part of the trip duration.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."online_cutoff" IS 'Deprecated, never read or written. Superseded by online_cutoff_minutes.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."online_cutoff_minutes" IS 'Per-trip override of operators.online_cutoff_minutes. Null = operator default.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."deposit_percentage" IS 'Percent charged up front. Null = pay in full.';
--> statement-breakpoint
COMMENT ON TABLE "trip_overrides" IS 'Admin-applied exceptions for a specific trip: cancellations or capacity changes.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_overrides"."capacity_override" IS 'Replacement capacity for this trip.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_overrides"."reason" IS 'Why the override was applied.';
--> statement-breakpoint
COMMENT ON TABLE "capacity_changes" IS 'Audit log of capacity adjustments made by staff on a trip.';
--> statement-breakpoint
COMMENT ON COLUMN "capacity_changes"."staff_id" IS 'Staff member who made the change.';
--> statement-breakpoint
COMMENT ON TABLE "customers" IS 'Consumer accounts, signed in by email one-time code. Separate from staff: incompatible auth and different data.';
--> statement-breakpoint
COMMENT ON COLUMN "customers"."email" IS 'Login identity, unique per operator.';
--> statement-breakpoint
COMMENT ON COLUMN "customers"."password_hash" IS 'Null = guest checkout.';
--> statement-breakpoint
COMMENT ON TABLE "magic_link_otps" IS '6-digit one-time sign-in codes for customers. Expire after 15 minutes.';
--> statement-breakpoint
COMMENT ON COLUMN "magic_link_otps"."otp_hash" IS 'bcrypt hash of the 6-digit code.';
--> statement-breakpoint
COMMENT ON COLUMN "magic_link_otps"."used" IS 'True once the code has been redeemed.';
--> statement-breakpoint
COMMENT ON TABLE "push_tokens" IS 'Expo push tokens for customer devices, used for confirmation, reminder and cancellation pushes.';
--> statement-breakpoint
COMMENT ON COLUMN "push_tokens"."expo_token" IS 'Expo push token for one device.';
--> statement-breakpoint
COMMENT ON COLUMN "push_tokens"."customer_email" IS 'Denormalized so pushes can reach guests without a customer row.';
--> statement-breakpoint
COMMENT ON COLUMN "push_tokens"."active" IS 'False once the device unregisters its token. Only active tokens receive pushes.';
--> statement-breakpoint
COMMENT ON TABLE "staff" IS 'Admin and mate accounts. Mates sign in to the tablet app with a PIN; admins sign in to the web dashboard with a password.';
--> statement-breakpoint
COMMENT ON COLUMN "staff"."role" IS 'admin (web dashboard) or mate (check-in app).';
--> statement-breakpoint
COMMENT ON COLUMN "staff"."pin_hash" IS 'bcrypt hash of the mate tablet PIN.';
--> statement-breakpoint
COMMENT ON COLUMN "staff"."password_hash" IS 'bcrypt hash of the admin web password.';
--> statement-breakpoint
COMMENT ON COLUMN "staff"."vessel_id" IS 'Boat a mate is assigned to.';
--> statement-breakpoint
COMMENT ON TABLE "bookings" IS 'One customer purchase. Can span several trips through booking_items.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."customer_id" IS 'Null = guest checkout.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."confirmation_code" IS '6-character code shown to the customer.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."status" IS 'pending (seats held, payment not confirmed) -> confirmed (payment_intent.succeeded) or cancelled (refunded, expired or admin-cancelled).';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."stripe_payment_intent_id" IS 'Stripe PaymentIntent for this booking.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."total_cents" IS 'Amount charged, in cents.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."platform_fee_cents" IS 'Platform fee for the booking: $1.50 x ticket count.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."group_discount_cents" IS 'Total group discount applied.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."customer_email" IS 'Contact email captured at checkout. Required even for guests.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."terms_version" IS 'Version of the terms the customer accepted.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."terms_accepted_at" IS 'When the customer accepted the terms.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."hold_expires_at" IS 'When the seat hold on a pending booking lapses. The expiry cron releases the seats after this.';
--> statement-breakpoint
COMMENT ON TABLE "booking_items" IS 'One row per trip within a booking (multi-trip cart). Tickets hang off it.';
--> statement-breakpoint
COMMENT ON COLUMN "booking_items"."subtotal_cents" IS 'Ticket total for this trip, in cents.';
--> statement-breakpoint
COMMENT ON TABLE "tickets" IS 'One per passenger, on one trip via its booking_item.';
--> statement-breakpoint
COMMENT ON COLUMN "tickets"."price_cents" IS 'Ticket price charged, in cents.';
--> statement-breakpoint
COMMENT ON COLUMN "tickets"."fee_amount_cents" IS 'Platform fee for this ticket, snapshotted when written. Never re-read from config.';
--> statement-breakpoint
COMMENT ON COLUMN "tickets"."fee_status" IS 'held at charge -> earned after departure + settle_grace_hrs, or reversed on cancellation. Revenue counts only earned.';
--> statement-breakpoint
COMMENT ON COLUMN "tickets"."passenger_name" IS 'Name on the boarding pass.';
--> statement-breakpoint
COMMENT ON COLUMN "tickets"."qr_payload" IS 'Value encoded in the boarding-pass QR code and matched when a mate scans it.';
--> statement-breakpoint
COMMENT ON COLUMN "tickets"."voided" IS 'True after refund, cancellation or dispute. A voided ticket cannot board.';
--> statement-breakpoint
COMMENT ON TABLE "payments" IS 'Stripe payment record, written when payment_intent.succeeded arrives.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."stripe_charge_id" IS 'Stripe Charge created by the PaymentIntent.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."stripe_transfer_id" IS 'Transfer to the operator''s connected account.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."application_fee_id" IS 'Stripe application fee object for the platform fee.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."amount_cents" IS 'Amount charged, in cents.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."application_fee_cents" IS 'Platform fee taken, in cents.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."status" IS 'Stripe PaymentIntent status.';
--> statement-breakpoint
COMMENT ON TABLE "check_ins" IS 'One boarding check-in per ticket. Can be recorded offline in the mate app and synced later.';
--> statement-breakpoint
COMMENT ON COLUMN "check_ins"."method" IS 'qr (scanned), name_search, or manual.';
--> statement-breakpoint
COMMENT ON COLUMN "check_ins"."staff_id" IS 'Mate who checked the passenger in.';
--> statement-breakpoint
COMMENT ON COLUMN "check_ins"."note" IS 'Reason for a manual override, e.g. walk-up or comp.';
--> statement-breakpoint
COMMENT ON COLUMN "check_ins"."checked_in_at" IS 'When the passenger was checked in on the device.';
--> statement-breakpoint
COMMENT ON COLUMN "check_ins"."synced_at" IS 'When the check-in reached the server. Null = originated offline.';
--> statement-breakpoint
COMMENT ON TABLE "fishing_reports" IS 'Captain''s report after a trip. One per trip.';
--> statement-breakpoint
COMMENT ON COLUMN "fishing_reports"."staff_id" IS 'Who posted the report.';
--> statement-breakpoint
COMMENT ON COLUMN "fishing_reports"."catch_summary" IS 'Free-text summary of the day.';
--> statement-breakpoint
COMMENT ON COLUMN "fishing_reports"."fish_counts" IS 'JSON array of {species, count}.';
--> statement-breakpoint
COMMENT ON COLUMN "fishing_reports"."photo_urls" IS 'Vercel Blob URLs of catch photos.';
--> statement-breakpoint
COMMENT ON TABLE "rate_limits" IS 'Fixed-window rate-limit buckets for auth and booking endpoints. Rows older than a day are deleted by the expire-pending-bookings cron.';
--> statement-breakpoint
COMMENT ON COLUMN "rate_limits"."key" IS 'Bucket name, e.g. otp-request:ip:1.2.3.4.';
--> statement-breakpoint
COMMENT ON COLUMN "rate_limits"."count" IS 'Requests counted in the current window.';
--> statement-breakpoint
COMMENT ON COLUMN "rate_limits"."window_start" IS 'Start of the current window.';
--> statement-breakpoint
COMMENT ON COLUMN "domains"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "vessels"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "products"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "schedules"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "schedule_prices"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "holiday_dates"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "trips"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "trip_overrides"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "capacity_changes"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "customers"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "magic_link_otps"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "push_tokens"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "staff"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "bookings"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "booking_items"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "tickets"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "payments"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "check_ins"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
--> statement-breakpoint
COMMENT ON COLUMN "fishing_reports"."operator_id" IS 'Owning operator. Every query on this table must filter by it.';
